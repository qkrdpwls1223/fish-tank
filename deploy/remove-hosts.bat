@echo off
REM 랜선어항 - hosts 항목 제거 도우미 (더블클릭 실행)
REM add-hosts.bat 로 추가한 fishtank.fllab.internal 줄을 hosts 에서 제거한다.
REM 관리자 권한이 필요하므로, 권한이 없으면 UAC 로 자동 상승 후 재실행한다.

setlocal
set "HOSTS=%SystemRoot%\System32\drivers\etc\hosts"
set "TMP=%TEMP%\hosts_fishtank_tmp.txt"

REM --- 관리자 권한 확인 ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 관리자 권한으로 다시 실행합니다...
    powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
    exit /b
)

REM --- 항목 존재 여부 확인 ---
findstr /i /c:"fishtank.fllab.internal" "%HOSTS%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [건너뜀] hosts 에 fishtank.fllab.internal 항목이 없습니다.
    echo.
    pause
    exit /b
)

REM --- fishtank.fllab.internal 을 포함하지 않는 줄만 남겨 다시 쓴다 ---
findstr /v /i /c:"fishtank.fllab.internal" "%HOSTS%" > "%TMP%"
copy /y "%TMP%" "%HOSTS%" >nul
del "%TMP%" >nul 2>&1

echo [완료] hosts 에서 fishtank.fllab.internal 항목을 제거했습니다.
echo.
pause
endlocal
