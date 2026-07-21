$ErrorActionPreference = "Stop"

$screens = Get-Content -Raw "c:\ED TECH\photobooth\screens.json" | ConvertFrom-Json

foreach ($s in $screens) {
    $name = $s.name
    $ssUrl = $s.screenshotUrl
    $htmlUrl = $s.htmlUrl

    Write-Host "Downloading $name..."

    # Download HTML
    curl.exe -sL $htmlUrl -o "${name}.html"

    # Download Screenshot
    curl.exe -sL $ssUrl -o "${name}.png"
}

Write-Host "All downloads completed."
