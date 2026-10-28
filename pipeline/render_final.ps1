# Final render: true 4K60, HEVC Main10 (sharp: no motion blur, no grain), in 4 parallel segments, then a
# lossless concat with the sound. Needs the no-HMR Vite on 5190 (see CLAUDE.md).
# usage (from the repo root):  pwsh -File pipeline/render_final.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$out = Join-Path $root 'out'
$dur = [double](Get-Content (Join-Path $root 'data/chapters.json') -Raw | ConvertFrom-Json).duration
$cuts = @(0, [math]::Round($dur / 4), [math]::Round($dur / 2), [math]::Round($dur * 3 / 4), $dur)   # equal quarters
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
# the sound: AAC 256k from the lossless master (build/master.wav, written by pipeline/mix.py) when it is here, else the
# repo's Opus 128k as is
$wav = Join-Path $root 'build/master.wav'
$audio = if (Test-Path $wav) { @('-i', $wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k') } else { @('-i', (Join-Path $root 'audio/chronicle.opus'), '-c', 'copy') }
ffmpeg -y -v error -f concat -safe 0 -i $list @audio -map 0:v -map 1:a -movflags +faststart $final
Write-Host "wrote $final"
