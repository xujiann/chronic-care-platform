# GitHub Publish Guide

## Current Windows Status

Git is already installed:

```text
git version 2.53.0.windows.1
```

Git path:

```text
C:\Program Files\Git\cmd\git.exe
```

GitHub CLI `gh` is not installed. It is optional. You can publish with Git only.

## Recommended First Publish Flow

1. Open GitHub in a browser.
2. Create a new repository, for example:

```text
chronic-care-platform
```

3. In PowerShell, run:

```powershell
cd "C:\Users\drxuj\OneDrive\3.信息化\0.高质量发展 信息化\chronic-care-platform"
git init
git add .
git commit -m "Initial chronic care platform MVP"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/chronic-care-platform.git
git push -u origin main
```

Replace `YOUR_NAME` with your GitHub username or organization name.

## If Git Asks Who You Are

Run:

```powershell
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

Then run the commit command again.

## Recommended Repository Strategy

Use one repository first:

```text
chronic-care-platform
```

Later, split into:

```text
chronic-care-admin
chronic-care-citizen
chronic-care-api
```

## GitHub Pages Note

GitHub Pages can host static pages only:

- `index.html`
- `citizen.html`
- `mobile-preview.html`
- CSS and JS files

The Node.js API in `server.js` cannot run on GitHub Pages. For API deployment, use a Node-capable platform or server.
