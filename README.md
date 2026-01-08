# 🎓 Quiz Helper - AI-Powered Quiz Assistant

An intelligent Chrome extension that uses ChatGPT to help you with online quizzes by displaying helpful hint bubbles with [somewhat] correct answers.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![AI Powered](https://img.shields.io/badge/AI-ChatGPT-orange)

## ✨ Features

- 🤖 **AI-Powered**: Uses ChatGPT (GPT-3.5-turbo) for intelligent answer analysis
- 💡 **Smart Hints**: Highlights answers in green
- 🎯 **Accurate**: ChatGPT sees actual answer text for better context
- ⚡ **Auto-Detection**: Automatically detects single vs. multiple answer questions
- 🔒 **Private**: All data stays between you and OpenAI
- 💰 **Affordable**: ~$0.001 per question (100 questions ≈ $0.10-0.20)

## 📋 Requirements

- Google Chrome or Chromium-based browser (Edge, Brave, etc.)
- OpenAI API key ([get one free here](https://platform.openai.com/api-keys))
- Internet connection

## 🚀 Installation

1. **Download** this repository:
   - Click the green "Code" button above
   - Select "Download ZIP"
   - Extract the ZIP file

2. **Load in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `extension` folder from the extracted files

3. **Add API Key**:
   - Click the extension icon in your toolbar
   - Paste your OpenAI API key
   - Click "Save API Key"

## 🎯 How to Use

1. **Navigate to a quiz** (works best with Microsoft Learn practice assessments)
2. **Click the extension icon** in your toolbar
3. **Toggle the switch to "On"**
4. **Wait a moment** - Correct answer(s) will be marked in green
5. **Select your answers** based on the hints
6. **Toggle off** when done to remove hints

## 🔧 Configuration

The extension requires an OpenAI API key to function. To get one:

1. Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign up or log in
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)
5. Paste it in the extension popup

**Note**: New OpenAI accounts get $5 in free credits!

## 💰 Costs

- Model used: `gpt-3.5-turbo`
- Cost per question: ~$0.001-0.002 (1/10th of a penny)
- 50 questions: ~$0.05-0.10
- 100 questions: ~$0.10-0.20

Very affordable for exam preparation!

## 🛠️ Technical Details

### How It Works

1. **Question Detection**: Scans the page for quiz questions using multiple selectors
2. **Answer Identification**: Finds associated answer choices (radio buttons, checkboxes)
3. **Smart Prompting**: Sends the question and answer choices to ChatGPT
4. **Response Matching**: Matches ChatGPT's response to actual answer text
5. **Hint Display**: Shows a styled hint bubble with the correct answer(s)

### Files Structure

```
extension/
├── manifest.json       # Extension configuration
├── content.js          # Main logic (question detection, ChatGPT API)
├── popup.html          # Popup interface
├── popup.js            # Popup functionality
├── background.js       # Background service worker
├── icon16.png          # Icon (16x16)
├── icon48.png          # Icon (48x48)
└── icon128.png         # Icon (128x128)
```

## 🔒 Privacy & Security

- Your API key is stored locally in Chrome's sync storage
- No data is collected or sent anywhere except directly to OpenAI
- The extension only runs when you explicitly enable it
- All communication is encrypted (HTTPS)

## ⚠️ Disclaimer

**For Educational Use Only**

This extension is designed for learning and study purposes. Use responsibly and in accordance with your institution's academic integrity policies. The accuracy of answers depends on ChatGPT's knowledge and may not always be 100% correct.

## 🐛 Troubleshooting

**Extension won't load:**
- Make sure all files are in the `extension` folder
- Check that `manifest.json` has no syntax errors
- Ensure all three icon files are present

**No hints appearing:**
- Check that you've added a valid OpenAI API key
- Open browser console (F12) and look for error messages
- Make sure the extension toggle is "On"
- Try refreshing the quiz page

**API errors:**
- Verify your API key is correct (starts with `sk-`)
- Check you have credits in your OpenAI account
- Look for rate limit messages in console

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📄 License

MIT License - feel free to use and modify as needed.

**Made with ❤️  for students and learners everywhere**
