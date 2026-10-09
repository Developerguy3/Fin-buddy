param([switch]$AcceptSdkLicense)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskTools=Join-Path $taskRoot '.build-tools'
$taskSdk=Join-Path $taskTools 'android-sdk'
New-Item -ItemType Directory -Force -Path $taskTools,$taskSdk | Out-Null
$taskJava=Get-ChildItem -LiteralPath $taskTools -Directory -Filter 'jdk-*' | Select-Object -First 1
if(!$taskJava){
 Write-Output 'Downloading official Temurin JDK 21…'
 $taskRelease=Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
 $taskPackage=$taskRelease[0].binary.package
 $taskZip=Join-Path $taskTools 'jdk.zip'
 Invoke-WebRequest -Uri $taskPackage.link -OutFile $taskZip
 if((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLower() -ne $taskPackage.checksum){throw 'JDK checksum mismatch.'}
 Expand-Archive -LiteralPath $taskZip -DestinationPath $taskTools -Force
 $taskJava=Get-ChildItem -LiteralPath $taskTools -Directory -Filter 'jdk-*' | Select-Object -First 1
}
$taskManager=Join-Path $taskSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if(!(Test-Path -LiteralPath $taskManager)){
 Write-Output 'Downloading official Android command-line tools…'
 $taskZip=Join-Path $taskTools 'android-cli.zip'
 Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $taskZip
 if((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLower() -ne '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'){throw 'Android SDK checksum mismatch.'}
 $taskExpand=Join-Path $taskTools 'android-cli-unpacked'
 Expand-Archive -LiteralPath $taskZip -DestinationPath $taskExpand -Force
 New-Item -ItemType Directory -Force -Path (Join-Path $taskSdk 'cmdline-tools') | Out-Null
 Copy-Item -LiteralPath (Join-Path $taskExpand 'cmdline-tools') -Destination (Join-Path $taskSdk 'cmdline-tools\latest') -Recurse -Force
}
$env:JAVA_HOME=$taskJava.FullName
$env:ANDROID_HOME=$taskSdk
if(!$AcceptSdkLicense){throw 'Run with -AcceptSdkLicense only after the user approves the Android SDK agreement.'}
Write-Output 'Installing the required Android packages under the SDK license approved by the user…'
1..5 | ForEach-Object {'y'} | & $taskManager --sdk_root=$taskSdk 'platforms;android-36' 'build-tools;36.0.0' 'platform-tools'
if($LASTEXITCODE -ne 0){throw 'Android SDK package installation failed.'}
$taskSdkEscaped=$taskSdk.Replace('\','/').Replace(':','\:')
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'android\local.properties') -Value ('sdk.dir='+$taskSdkEscaped) -Encoding utf8
Write-Output 'Android build tools ready.'
