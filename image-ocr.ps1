param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-Operation($operation, $resultType) {
    $task = $taskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    $task.Result
}
$file = Wait-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Wait-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Wait-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Wait-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Windows OCR language is unavailable.' }
$result = Wait-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$words = @($result.Lines | ForEach-Object { $_.Words | ForEach-Object { @{ text=$_.Text; x0=$_.BoundingRect.X; x1=$_.BoundingRect.X+$_.BoundingRect.Width; top=$_.BoundingRect.Y; bottom=$_.BoundingRect.Y+$_.BoundingRect.Height } } })
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@{ text=$result.Text; words=$words; width=$bitmap.PixelWidth; height=$bitmap.PixelHeight } | ConvertTo-Json -Depth 5 -Compress
$bitmap.Dispose()
$stream.Dispose()
