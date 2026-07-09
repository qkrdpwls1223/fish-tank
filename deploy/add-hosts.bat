@echo off
REM 공유 어항 - hosts 등록 도우미 (더블클릭 실행)
REM 관리자 권한이 필요하므로, 권한이 없으면 UAC 로 자동 상승 후 재실행한다.
REM hosts 에 fishtank.fllab.internal 항목이 없을 때만 추가한다(중복 방지).

setlocal
set "ENTRY=10.10.33.36 fishtank.fllab.internal"
set "HOSTS=%SystemRoot%\System32\drivers\etc\hosts"

REM --- 관리자 권한 확인 ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 관리자 권한으로 다시 실행합니다...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
    exit /b
)

REM --- 이미 등록돼 있는지 확인 ---
findstr /i /c:"fishtank.fllab.internal" "%HOSTS%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [건너뜀] fishtank.fllab.internal 항목이 이미 hosts 에 있습니다.
    echo.
    echo 현재 등록된 줄:
    findstr /i /c:"fishtank.fllab.internal" "%HOSTS%"
    echo.
    pause
    exit /b
)

REM --- 추가 ---
echo.>> "%HOSTS%"
echo %ENTRY%>> "%HOSTS%"

if %errorlevel% equ 0 (
    echo [완료] hosts 에 다음 줄을 추가했습니다:
    echo     %ENTRY%
    echo.
    echo 이제 Teams 에서 "공유 어항" 앱을 열 수 있습니다.
) else (
    echo [실패] hosts 파일 쓰기에 실패했습니다. 관리자 권한을 확인하세요.
)
echo.
pause
endlocal
