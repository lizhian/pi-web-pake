use std::os::windows::{io::AsRawHandle, process::CommandExt};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenThread, ResumeThread, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME},
    },
};

#[derive(Debug)]
pub(crate) struct ManagedProcess {
    child: Child,
    job: WindowsJob,
}

impl ManagedProcess {
    pub(crate) fn spawn(command: &str) -> Result<Self, String> {
        spawn_server(command)
    }
    pub(crate) fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
}

impl Drop for ManagedProcess {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            match Command::new("taskkill")
                .args(["/PID", &self.child.id().to_string(), "/T"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
            {
                Ok(status) if status.success() => {}
                result => eprintln!("[Pake] Local server graceful shutdown failed: {result:?}"),
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        unsafe {
            if TerminateJobObject(self.job.handle(), 1) == 0 {
                eprintln!(
                    "[Pake] Could not terminate the local server job: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
        if let Err(error) = self.child.wait() {
            eprintln!("[Pake] Could not reap the local server: {error}");
        }
    }
}

fn shell_command(command: &str) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut process = Command::new("cmd.exe");
    // cmd.exe parses its command string itself, without CRT argument escaping.
    process
        .args(["/D", "/S", "/C"])
        .raw_arg(format!("\"{command}\""));
    process.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    process
}

#[derive(Debug)]
struct WindowsJob(isize);

struct WindowsSnapshot(HANDLE);

impl WindowsJob {
    fn handle(&self) -> HANDLE {
        self.0 as HANDLE
    }
}

impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle());
        }
    }
}

impl Drop for WindowsSnapshot {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn resume_process_threads(child: &Child) -> Result<(), String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!(
                "Could not inspect the suspended local server process: {}",
                std::io::Error::last_os_error()
            ));
        }
        let _snapshot = WindowsSnapshot(snapshot);

        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut has_entry = Thread32First(snapshot, &mut entry);
        if has_entry == 0 {
            return Err(format!(
                "Could not enumerate the suspended local server threads: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut resumed = false;
        while has_entry != 0 {
            if entry.th32OwnerProcessID == child.id() {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if thread.is_null() {
                    return Err(format!(
                        "Could not open a suspended local server thread: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                let result = ResumeThread(thread);
                let resume_error = (result == u32::MAX).then(std::io::Error::last_os_error);
                CloseHandle(thread);
                if let Some(error) = resume_error {
                    return Err(format!(
                        "Could not resume the local server process: {error}"
                    ));
                }
                resumed = true;
            }
            has_entry = Thread32Next(snapshot, &mut entry);
        }

        if resumed {
            Ok(())
        } else {
            Err("Could not find the suspended local server thread.".to_string())
        }
    }
}

fn create_kill_on_close_job(child: &Child) -> Result<WindowsJob, String> {
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(format!(
                "Could not create a Windows job object: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(handle);
            return Err(format!(
                "Could not configure the Windows job object: {error}"
            ));
        }

        if AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(handle);
            return Err(format!(
                "Could not attach the local server to its Windows job object: {error}"
            ));
        }

        let job = WindowsJob(handle as isize);
        resume_process_threads(child)?;
        Ok(job)
    }
}

fn spawn_server(command: &str) -> Result<ManagedProcess, String> {
    let mut process = shell_command(command);
    process
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = process
        .spawn()
        .map_err(|error| format!("Could not start the local server command: {error}"))?;

    let job = match create_kill_on_close_job(&child) {
        Ok(job) => job,
        Err(error) => {
            let mut child = child;
            if let Err(cleanup) = child.kill() {
                eprintln!("[Pake] Could not stop the suspended local server: {cleanup}");
            }
            if let Err(cleanup) = child.wait() {
                eprintln!("[Pake] Could not reap the suspended local server: {cleanup}");
            }
            return Err(error);
        }
    };

    Ok(ManagedProcess { child, job })
}
