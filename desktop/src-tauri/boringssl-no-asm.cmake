# CMake toolchain file for the C/C++ libraries cmake-rs builds for the MSVC
# target (BoringSSL from the Studio's wreq/boring-sys2, and audiopus). Passed
# via CMAKE_TOOLCHAIN_FILE_x86_64_pc_windows_msvc in .cargo/config.toml.

# BoringSSL without assembly, so the build needs no NASM.
set(OPENSSL_NO_ASM ON CACHE BOOL "Build BoringSSL without assembly (no NASM)" FORCE)

# Buzz links the static CRT on Windows (sherpa-onnx ships /MT libraries), so
# C++ objects must use it too or MSVC refuses to link (LNK2038 RuntimeLibrary
# mismatch). cmake-rs passes -MD in the flags; switch those to -MT.
foreach(lang C CXX)
  foreach(config "" _DEBUG _RELEASE _RELWITHDEBINFO _MINSIZEREL)
    if(DEFINED CMAKE_${lang}_FLAGS${config})
      string(REPLACE "-MD" "-MT" CMAKE_${lang}_FLAGS${config} "${CMAKE_${lang}_FLAGS${config}}")
    endif()
  endforeach()
endforeach()
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
