!define JOUZU_HOOK_DIRECTORY "${__FILEDIR__}"

!macro JOUZU_LAUNCHER_ONLY_REPLACE
  InitPluginsDir
  File /oname=$PLUGINSDIR\replace-locked-launcher-files.ps1 "${JOUZU_HOOK_DIRECTORY}\replace-locked-launcher-files.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\replace-locked-launcher-files.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$1"
    Abort
  ${EndIf}
!macroend

!macro JOUZU_STOP_ALL
  IfSilent +3
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(jouzuCloseSessions)" IDOK +2
  Abort
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-managed-processes.ps1 "${JOUZU_HOOK_DIRECTORY}\stop-managed-processes.ps1"
  ${If} $UpdateMode = 1
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-managed-processes.ps1" -RefuseActiveSessions -InstallRoot "$INSTDIR"'
  ${Else}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-managed-processes.ps1" -InstallRoot "$INSTDIR"'
  ${EndIf}
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(jouzuCloseFailed)"
    Abort
  ${EndIf}
!macroend

!macro JOUZU_STOP_MANAGED
!if ${JOUZU_LAUNCHER_ONLY} == 1
  ; A launcher-only package leaves the payload in place, so running sessions stay open; only
  ; locked launcher-owned executables are renamed aside for replacement.
  !insertmacro JOUZU_LAUNCHER_ONLY_REPLACE
!else
  !insertmacro JOUZU_STOP_ALL
!endif
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Removing the installation deletes its files, so the launcher has to stop as well. The
  ; launcher-only package's keep-sessions behaviour belongs to replacing files during an update,
  ; not to an uninstall that would otherwise delete files from under a running launcher.
  !insertmacro JOUZU_STOP_ALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\runtime\launcher-update\git-environment.ps1" -InstallRoot "$INSTDIR" -Prepare'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$1"
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; A launcher-only package does not carry the payload file list, so remove it explicitly. An
    ; update keeps the payload: it replaces the launcher, it does not remove the installation.
    RmDir /r "\\?\$INSTDIR\app"
    RmDir /r "\\?\$INSTDIR\runtime"
    Delete "$INSTDIR\*.old-*"
    ; Leftovers mean something still holds these files, usually a launcher or a session that
    ; started again, so the uninstall says so instead of reporting success.
    ${If} ${FileExists} "$INSTDIR\app\*.*"
    ${OrIf} ${FileExists} "$INSTDIR\runtime\*.*"
    ${OrIf} ${FileExists} "$INSTDIR\*.old-*"
      SetErrorLevel 1
      IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "$(jouzuRemoveFailed)"
    ${EndIf}
  ${EndIf}
!macroend
