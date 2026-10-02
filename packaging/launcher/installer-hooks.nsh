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

!macro JOUZU_STOP_MANAGED
!if ${JOUZU_LAUNCHER_ONLY} == 1
  ; A launcher-only package leaves the payload in place, so running sessions stay open; only
  ; locked launcher-owned executables are renamed aside for replacement.
  !insertmacro JOUZU_LAUNCHER_ONLY_REPLACE
!else
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
!endif
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro JOUZU_STOP_MANAGED
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
  ; A launcher-only package does not carry the payload file list, so remove it explicitly.
  RmDir /r "\\?\$INSTDIR\app"
  RmDir /r "\\?\$INSTDIR\runtime"
  Delete "$INSTDIR\*.old-*"
!macroend
