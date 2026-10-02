!define JOUZU_HOOK_DIRECTORY "${__FILEDIR__}"
!macro JOUZU_STOP_MANAGED
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

!macro NSIS_HOOK_PREINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro JOUZU_STOP_MANAGED
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR
untime\launcher-update\git-environment.ps1" -InstallRoot "$INSTDIR" -Prepare'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$1"
    Abort
  ${EndIf}
!macroend
