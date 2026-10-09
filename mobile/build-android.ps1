param([ValidateSet('Debug','Release')][string]$BuildType='Release')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskTools=Join-Path $taskRoot '.build-tools'
$taskJava=Get-ChildItem -LiteralPath $taskTools -Directory -Filter 'jdk-*' | Select-Object -First 1
if(!$taskJava){throw 'Run setup-android.ps1 first.'}
$env:JAVA_HOME=$taskJava.FullName
$env:ANDROID_HOME=Join-Path $taskTools 'android-sdk'
$env:GRADLE_USER_HOME=Join-Path $env:LOCALAPPDATA 'FinBuddyBuild/gradle-cache'
Push-Location (Join-Path $PSScriptRoot 'android')
try {& .\gradlew.bat ('assemble'+$BuildType) --no-daemon --console=plain;if($LASTEXITCODE -ne 0){throw 'Android build failed.'}} finally {Pop-Location}
