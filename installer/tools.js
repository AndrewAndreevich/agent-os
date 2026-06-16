module.exports = {
  base: [
    {
      name: 'git',
      check_cmd: 'git --version',
      check_regex: /git version (\d+\.\d+)/,
      min_version: '2.0',
      install: {
        windows: 'winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'apt-get install -y git',
        mac: 'brew install git'
      },
      post_install: {
        windows: '$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")'
      },
      path_hint: {
        windows: 'C:\\Program Files\\Git\\bin',
        linux: '/usr/bin',
        mac: '/usr/local/bin'
      },
      notes_windows: 'Git for Windows also installs Git Bash — available at C:\\Program Files\\Git\\bin\\bash.exe'
    },
    {
      name: 'node',
      check_cmd: 'node --version',
      check_regex: /v(\d+)\.\d+/,
      min_version: '20',
      install: {
        windows: 'winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs',
        mac: 'brew install node@20'
      },
      post_install: {
        windows: '$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")'
      },
      path_hint: {
        windows: 'C:\\Program Files\\nodejs',
        linux: '/usr/bin',
        mac: '/usr/local/bin'
      }
    },
    {
      name: 'python',
      check_cmd: 'python --version',
      check_cmd_linux: 'python3 --version',
      check_regex: /Python (\d+\.\d+)/,
      min_version: '3.10',
      install: {
        windows: 'winget install --id Python.Python.3.11 -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'apt-get install -y python3.11 python3-pip python3-venv',
        mac: 'brew install python@3.11'
      },
      post_install: {
        windows: '$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")'
      },
      path_hint: {
        windows: 'C:\\Users\\%USERNAME%\\AppData\\Local\\Programs\\Python\\Python311',
        linux: '/usr/bin',
        mac: '/usr/local/bin'
      }
    },
    {
      name: 'pm2',
      check_cmd: 'pm2 --version',
      check_regex: /(\d+\.\d+)/,
      min_version: '5.0',
      install: {
        windows: 'npm install -g pm2 && npm install -g pm2-windows-startup',
        linux: 'npm install -g pm2',
        mac: 'npm install -g pm2'
      },
      post_install: {
        windows: 'pm2-startup install',
        linux: 'env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME',
        mac: 'pm2 startup'
      },
      notes_windows: 'PM2 autostart is handled via Windows Task Scheduler through pm2-windows-startup'
    },
    {
      name: 'claude-code',
      check_cmd: 'claude --version',
      check_regex: /(\d+\.\d+)/,
      min_version: '1.0',
      install: {
        windows: 'npm install -g @anthropic-ai/claude-code',
        linux: 'npm install -g @anthropic-ai/claude-code',
        mac: 'npm install -g @anthropic-ai/claude-code'
      },
      notes_windows: 'Requires ANTHROPIC_API_KEY to be set in .env'
    }
  ],

  extended: [
    {
      name: 'blender',
      capability: 'blender',
      check_cmd: 'blender --version',
      check_regex: /Blender (\d+\.\d+)/,
      min_version: '3.0',
      install: {
        windows: 'winget install --id BlenderFoundation.Blender -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'snap install blender --classic',
        mac: 'brew install --cask blender'
      },
      path_hint: {
        windows: 'C:\\Program Files\\Blender Foundation\\Blender 4.1',
        linux: '/snap/bin',
        mac: '/Applications/Blender.app/Contents/MacOS'
      },
      notes_windows: 'After install, add Blender to PATH or use full path in scripts'
    },
    {
      name: 'dotnet',
      capability: 'dotnet',
      check_cmd: 'dotnet --version',
      check_regex: /(\d+\.\d+)/,
      min_version: '6.0',
      install: {
        windows: 'winget install --id Microsoft.DotNet.SDK.8 -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'apt-get install -y dotnet-sdk-8.0',
        mac: 'brew install --cask dotnet-sdk'
      }
    },
    {
      name: 'playwright',
      capability: 'playwright',
      check_cmd: 'npx playwright --version',
      check_regex: /Version (\d+\.\d+)/,
      min_version: '1.0',
      install: {
        windows: 'npm install -g playwright && npx playwright install chromium',
        linux: 'npm install -g playwright && npx playwright install chromium && npx playwright install-deps chromium',
        mac: 'npm install -g playwright && npx playwright install chromium'
      }
    },
    {
      name: 'unity-hub',
      capability: 'unity',
      check_cmd: '"C:\\Program Files\\Unity Hub\\Unity Hub.exe" -- --headless version',
      check_cmd_fallback: 'unity-hub --version',
      check_regex: /(\d+\.\d+)/,
      min_version: '3.0',
      install: {
        windows: 'winget install --id Unity.UnityHub -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'apt-get install unityhub',
        mac: 'brew install --cask unity-hub'
      },
      path_hint: {
        windows: 'C:\\Program Files\\Unity Hub'
      },
      notes_windows: 'After Unity Hub installs, open it and install Unity 2022.3 LTS editor'
    },
    {
      name: 'qgis',
      capability: 'qgis',
      check_cmd: 'qgis --version',
      check_regex: /QGIS (\d+\.\d+)/,
      min_version: '3.0',
      install: {
        windows: 'winget install --id QGIS.QGIS -e --source winget --accept-package-agreements --accept-source-agreements',
        linux: 'apt-get install -y qgis',
        mac: 'brew install --cask qgis'
      }
    }
  ]
};
