@echo off
rem ============================================================
rem  Puente de impresion - Pumpkin Zone Taquilla
rem  Doble clic para iniciar. Deja esta ventana abierta mientras
rem  se vende. Si se cierra, la taquilla imprime por la ventana
rem  de respaldo del navegador.
rem
rem  1) Edita config-impresora.txt con la IP de tu Epson Ethernet
rem  2) Doble clic a este archivo
rem  3) En la taquilla: Ajustes -> "Guardar y probar puente"
rem ============================================================
cd /d "%~dp0"

rem Lee la IP de la impresora desde config-impresora.txt
set PRINTER_HOST=192.168.1.100
if exist config-impresora.txt (
  for /f "usebackq tokens=* delims=" %%a in ("config-impresora.txt") do (
    echo %%a | findstr /b /c:"#" >nul || set PRINTER_HOST=%%a
  )
)

title Puente de impresion - Pumpkin Zone (impresora %PRINTER_HOST%)
echo.
echo  Puente de impresion de Pumpkin Zone
echo  Impresora: %PRINTER_HOST%:9100
echo  Escuchando en http://127.0.0.1:9631
echo.
echo  NO cierres esta ventana mientras la taquilla este abierta.
echo.

:loop
node print-bridge.mjs
echo.
echo  El puente se detuvo. Reiniciando en 3 segundos... (Ctrl+C para salir)
timeout /t 3 /nobreak >nul
goto loop
