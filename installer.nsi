!include "MUI2.nsh"

; Basic info
Name "KairozunVPN"
OutFile "dist\KairozunVPN-Setup.exe"
InstallDir "$PROGRAMFILES\KairozunVPN"
InstallDirRegKey HKLM "Software\KairozunVPN" "InstallDir"
RequestExecutionLevel admin

; UI
!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_ABORTWARNING

; Finish page — запускать приложение после установки
!define MUI_FINISHPAGE_RUN "$INSTDIR\KairozunVPN.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить KairozunVPN"
!define MUI_FINISHPAGE_RUN_CHECKED

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "Russian"

; Install section
Section "KairozunVPN" SecMain
  ; Закрываем приложение если запущено
  nsExec::ExecToLog 'taskkill /f /im KairozunVPN.exe'
  nsExec::ExecToLog 'taskkill /f /im electron.exe'
  Sleep 1000

  SetOutPath "$INSTDIR"
  
  ; Copy all files from packaged app — /REBOOTOK для заблокированных файлов
  File /r "dist\KairozunVPN-win32-x64\*.*"
  
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  
  ; Registry
  WriteRegStr HKLM "Software\KairozunVPN" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN" "DisplayName" "KairozunVPN"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN" "DisplayIcon" '"$INSTDIR\KairozunVPN.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN" "Publisher" "Kairozun"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN" "DisplayVersion" "1.0.0"
  
  ; Desktop shortcut
  CreateShortcut "$DESKTOP\KairozunVPN.lnk" "$INSTDIR\KairozunVPN.exe" "" "$INSTDIR\KairozunVPN.exe" 0
  
  ; Start menu
  CreateDirectory "$SMPROGRAMS\KairozunVPN"
  CreateShortcut "$SMPROGRAMS\KairozunVPN\KairozunVPN.lnk" "$INSTDIR\KairozunVPN.exe" "" "$INSTDIR\KairozunVPN.exe" 0
  CreateShortcut "$SMPROGRAMS\KairozunVPN\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

; Uninstall section
Section "Uninstall"
  ; Закрываем приложение перед удалением
  nsExec::ExecToLog 'taskkill /f /im KairozunVPN.exe'
  nsExec::ExecToLog 'taskkill /f /im electron.exe'
  Sleep 500

  ; Remove files
  RMDir /r "$INSTDIR"
  
  ; Remove shortcuts
  Delete "$DESKTOP\KairozunVPN.lnk"
  RMDir /r "$SMPROGRAMS\KairozunVPN"
  
  ; Remove registry
  DeleteRegKey HKLM "Software\KairozunVPN"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KairozunVPN"
SectionEnd
