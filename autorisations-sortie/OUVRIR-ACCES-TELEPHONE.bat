@echo off
chcp 65001 >nul
title Ouvrir l'acces depuis les telephones
rem Relance automatiquement ce fichier en administrateur (necessaire pour le pare-feu)
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outils\acces-telephone.ps1"
pause
