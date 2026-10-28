# Final render: true 4K60, HEVC Main10 (sharp: no motion blur, no grain), in 4 parallel segments, then a
# lossless concat with the master audio. Needs the no-HMR Vite on 5190 (see CLAUDE.md).
# usage (from the repo root):  pwsh -File pipeline/render_final.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$out = Join-Path $root 'out'
$dur = [double](Get-Content (Join-Path $root 'data/chapters.json') -Raw | ConvertFrom-Json).duration
$cuts = @(0, 204, 408, 612, $dur)
$jobs = @()
for ($k = 0; $k -lt 4; $k++) {
  $a = $cuts[$k]; $b = $cuts[$k + 1]
  $seg = Join-Path $out "seg4k_$k.mp4"
  $log = Join-Path $out "seg4k_$k.log"
  $jobs += Start-Process -FilePath bun -WorkingDirectory $app -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" -ArgumentList @(
    'scripts/render.ts', 'video', '--url', 'http://127.0.0.1:5190', '--scale', '2', '--samples', '1', '--no-grain',
    '--codec', 'hevc_nvenc', '--cq', '18', '--maxrate', '32M', '--10bit', '--from', "$a", '--to', "$b", '--noaudio', '--out', $seg)
}
$jobs | Wait-Process
foreach ($j in $jobs) { if ($j.ExitCode -ne 0) { throw "segment failed (exit $($j.ExitCode)); see out/seg4k_*.log" } }
$list = Join-Path $out 'seg4k.txt'
(0..3 | ForEach-Object { "file 'seg4k_$_.mp4'" }) | Set-Content $list -Encoding ascii
$final = Join-Path $out 'teyvat-chronicle-4k.mp4'
ffmpeg -y -v error -f concat -safe 0 -i $list -i (Join-Path $root 'audio/chronicle.m4a') -map 0:v -map 1:a -c copy -movflags +faststart $final
Write-Host "wrote $final"
