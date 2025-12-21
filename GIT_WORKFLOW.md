# Git Workflow for Disney Infinity Community Server

## 🔧 Git Setup & Usage

### Windows (PowerShell) - RECOMMENDED

Use the full path to git.exe to avoid PATH issues:

```powershell
# Check status
& "C:\Program Files\Git\bin\git.exe" status

# Add files
& "C:\Program Files\Git\bin\git.exe" add .

# Commit changes
& "C:\Program Files\Git\bin\git.exe" commit -m "Your commit message"

# Push changes
& "C:\Program Files\Git\bin\git.exe" push origin master
```

### Linux/Mac (Bash)

```bash
# Use standard git commands
git status
git add .
git commit -m "Your commit message"
git push origin master
```

### Helper Scripts

Use the provided helper scripts for consistent operations:

#### Windows PowerShell
```powershell
# Run git commands using the helper
.\git-helper.ps1 status
.\git-helper.ps1 add .
.\git-helper.ps1 commit -m "Fix database connectivity"
.\git-helper.ps1 push origin master
```

#### Linux/Mac Bash
```bash
# Make script executable first
chmod +x git-helper.sh

# Run git commands
./git-helper.sh status
./git-helper.sh add .
./git-helper.sh commit -m "Fix database connectivity"
./git-helper.sh push origin master
```

## 📋 Standard Workflow

### 1. Check Current Status
```powershell
& "C:\Program Files\Git\bin\git.exe" status
```

### 2. Review Changes
```powershell
& "C:\Program Files\Git\bin\git.exe" diff
```

### 3. Stage Changes
```powershell
# Stage all changes
& "C:\Program Files\Git\bin\git.exe" add .

# Or stage specific files
& "C:\Program Files\Git\bin\git.exe" add config/database.js server.js
```

### 4. Commit Changes
```powershell
& "C:\Program Files\Git\bin\git.exe" commit -m "Brief description of changes

- Detailed explanation of what was changed
- Why the change was needed
- Any breaking changes or important notes"
```

### 5. Push to Remote
```powershell
& "C:\Program Files\Git\bin\git.exe" push origin master
```

## 🚨 Important Notes

### PATH Issues
- Always use full path `& "C:\Program Files\Git\bin\git.exe"` in PowerShell
- Do NOT use just `git` command as it may not be in PATH

### Working Directory
- Always run git commands from the `infinity-community-server` directory
- The helper scripts automatically change to the correct directory

### Branch Strategy
- Use `master` as the main branch
- Create feature branches for significant changes:
  ```powershell
  & "C:\Program Files\Git\bin\git.exe" checkout -b feature/new-feature
  ```

### Commit Messages
Follow conventional commit format:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Testing changes

### Deployment
- Pushing to `master` automatically triggers Render deployment
- Always test changes locally before pushing
- Monitor Render dashboard after push for deployment status

## 🐛 Troubleshooting

### "git is not recognized"
- Use full path: `& "C:\Program Files\Git\bin\git.exe"`
- Check if Git is installed in `C:\Program Files\Git\bin\`

### "fatal: not a git repository"
- Ensure you're in the `infinity-community-server` directory
- Check if the `.git` folder exists

### Push Rejected
```powershell
# Pull latest changes first
& "C:\Program Files\Git\bin\git.exe" pull origin master --rebase

# Then push
& "C:\Program Files\Git\bin\git.exe" push origin master
```

### Permission Denied
- Check if you have write access to the repository
- Verify your SSH keys or personal access tokens are configured

## 📞 Support

If you encounter git issues:
1. Check this documentation first
2. Use the helper scripts when possible
3. Always use full paths in PowerShell
4. Test commands individually before combining them
