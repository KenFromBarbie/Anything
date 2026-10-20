//! Processes that must not outlive the app (the Offices and their agent
//! terminals, local relays). On Windows they join one Job Object that kills
//! everything in it when its last handle closes: the app holds that handle
//! for its whole life, so the OS reaps them even if the app crashes or is
//! killed. Before this, a hard stop left an Office running, still polling
//! the relay, and competing with the next one for the same data folder.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    /// The job's handle, as an integer (a raw HANDLE isn't Sync). Never closed:
    /// closing it is what kills the members, which happens when the app exits.
    static JOB: OnceLock<Option<isize>> = OnceLock::new();

    fn job() -> Option<isize> {
        *JOB.get_or_init(|| {
            use std::ptr::null;
            use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
            use windows_sys::Win32::System::JobObjects::{
                CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            #[allow(unsafe_code)]
            unsafe {
                let job = CreateJobObjectW(null(), null());
                if job.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == FALSE {
                    CloseHandle(job);
                    return None;
                }
                Some(job as isize)
            }
        })
    }

    pub fn tie_to_app(pid: u32) {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };
        let Some(job) = job() else {
            eprintln!("buzz-desktop: no app job object; process {pid} may outlive the app");
            return;
        };
        #[allow(unsafe_code)]
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid);
            if process.is_null() {
                return;
            }
            if AssignProcessToJobObject(job as _, process) == FALSE {
                eprintln!("buzz-desktop: could not tie process {pid} to the app");
            }
            CloseHandle(process);
        }
    }
}

/// Make `pid` (and everything it starts from now on) end with the app.
/// A no-op off Windows, where the children stop with the app's shutdown.
pub(crate) fn tie_to_app(pid: u32) {
    #[cfg(windows)]
    imp::tie_to_app(pid);
    #[cfg(not(windows))]
    let _ = pid;
}
