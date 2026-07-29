param(
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,

    [string]$DestinationPath = (Get-Location).Path,

    [switch]$RunInstall
)

$ErrorActionPreference = 'Stop'

$resolvedZipPath = (Resolve-Path $ZipPath).Path

if (-not (Test-Path $DestinationPath)) {
    throw "Destination path does not exist: $DestinationPath"
}

$resolvedDestinationPath = (Resolve-Path $DestinationPath).Path
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("inventory-app-import-" + [Guid]::NewGuid().ToString())

$expectedRepoFiles = @(
    'package.json',
    '.gitignore'
)

$restoredFiles = New-Object System.Collections.Generic.List[string]

try {
    foreach ($repoFile in $expectedRepoFiles) {
        $candidatePath = Join-Path $resolvedDestinationPath $repoFile
        if (-not (Test-Path $candidatePath)) {
            throw "Destination does not look like the repo root. Missing $repoFile in $resolvedDestinationPath"
        }
    }

    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    Expand-Archive -Path $resolvedZipPath -DestinationPath $stagingRoot -Force

    $filesToRestore = Get-ChildItem -Path $stagingRoot -Recurse -File | Where-Object {
        $_.Name -ne 'RESTORE-STEPS.txt'
    }

    if (-not $filesToRestore) {
        throw 'The transfer archive did not contain any restorable files.'
    }

    foreach ($file in $filesToRestore) {
        $relativePath = $file.FullName.Substring($stagingRoot.Length).TrimStart('\')
        $destinationFile = Join-Path $resolvedDestinationPath $relativePath
        $destinationDir = Split-Path -Parent $destinationFile

        if ($destinationDir -and -not (Test-Path $destinationDir)) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }

        Copy-Item -Path $file.FullName -Destination $destinationFile -Force
        $restoredFiles.Add($relativePath)
    }

    Write-Host "Restored transfer files into: $resolvedDestinationPath"
    Write-Host 'Restored files:'
    $restoredFiles | ForEach-Object { Write-Host (" - " + $_) }

    $missingFiles = $restoredFiles | Where-Object {
        -not (Test-Path (Join-Path $resolvedDestinationPath $_))
    }

    if ($missingFiles) {
        throw ("Restore verification failed. Missing files: " + ($missingFiles -join ', '))
    }

    Write-Host ''
    Write-Host 'Next steps:'
    Write-Host ' - Run npm install'
    Write-Host ' - Run npm run dev'

    if ($RunInstall) {
        Write-Host ''
        Write-Host 'Running npm install...'
        Push-Location $resolvedDestinationPath
        try {
            npm install
        }
        finally {
            Pop-Location
        }
    }
}
finally {
    if (Test-Path $stagingRoot) {
        Remove-Item -Path $stagingRoot -Recurse -Force
    }
}