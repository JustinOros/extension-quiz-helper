let extensionEnabled = false;
let isProcessing = false;
let processedQuestions = new Set();
let openaiApiKey = null;
let styleInjected = false;

// Inject custom CSS for highlighting
function injectCustomStyles() {
  if (styleInjected) return;
  
  const style = document.createElement('style');
  style.id = 'quiz-helper-styles';
  style.textContent = `
    .quiz-helper-correct {
      background-color: #90EE90 !important;
      border: 3px solid #28a745 !important;
      box-shadow: 0 0 10px rgba(40, 167, 69, 0.6) !important;
      padding: 8px !important;
      border-radius: 4px !important;
      transition: all 0.3s ease !important;
    }
    
    .quiz-helper-correct * {
      background-color: transparent !important;
    }
    
    .quiz-helper-unknown {
      background-color: #FFB6C1 !important;
      border: 3px solid #dc3545 !important;
      box-shadow: 0 0 10px rgba(220, 53, 69, 0.6) !important;
      padding: 8px !important;
      border-radius: 4px !important;
      transition: all 0.3s ease !important;
    }
    
    .quiz-helper-unknown * {
      background-color: transparent !important;
    }
  `;
  document.head.appendChild(style);
  styleInjected = true;
  console.log('✓ Custom CSS styles injected');
}

// Initialize extension state
chrome.storage.sync.get(['enabled', 'openaiApiKey'], function(result) {
  extensionEnabled = result.enabled || false;
  openaiApiKey = result.openaiApiKey || null;
  
  if (openaiApiKey) {
    console.log('✓ OpenAI API key loaded');
  } else {
    console.log('⚠ No OpenAI API key found. Please add one in the extension popup.');
  }
  
  if (extensionEnabled) {
    injectCustomStyles();
    waitForContentAndScan();
  }
});

// Listen for toggle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleExtension') {
    extensionEnabled = request.enabled;
    
    if (extensionEnabled) {
      if (!openaiApiKey) {
        console.error('❌ Cannot enable: No OpenAI API key set. Please add one in the extension popup.');
      } else {
        injectCustomStyles();
        waitForContentAndScan();
      }
    } else {
      removeHighlights();
      processedQuestions.clear();
    }
  } else if (request.action === 'apiKeyUpdated') {
    openaiApiKey = request.apiKey;
    console.log('✓ OpenAI API key updated');
    processedQuestions.clear();
  }
});

// Wait for dynamic content to load before scanning
function waitForContentAndScan() {
  console.log('Waiting for quiz content to load...');
  
  let attempts = 0;
  const maxAttempts = 40;
  
  const checkContent = setInterval(() => {
    attempts++;
    
    const hasContent = document.body.innerText.length > 500;
    const hasInteractiveElements = document.querySelectorAll('button, input, label').length > 5;
    const mainContent = document.querySelector('[data-main-column]');
    const hasMainContent = mainContent && mainContent.innerText.length > 100;
    const hasQuizElements = document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
    
    console.log(`Attempt ${attempts}: content=${hasContent}, interactive=${hasInteractiveElements}, main=${hasMainContent}, quiz=${hasQuizElements}`);
    
    if ((hasContent && hasInteractiveElements && hasMainContent) || hasQuizElements) {
      clearInterval(checkContent);
      console.log('✓ Quiz content detected! Starting scan in 2 seconds...');
      setTimeout(() => scanAndHighlight(), 2000);
    } else if (attempts >= maxAttempts) {
      clearInterval(checkContent);
      console.log('✗ Timeout: Quiz content did not load. Try refreshing the page.');
    }
  }, 500);
}

// Function to identify potential questions
function findQuestions() {
  const questions = [];
  const seenTexts = new Set();
  
  console.log('DEBUG: Total body text length:', document.body.innerText.length);
  console.log('DEBUG: Sample text:', document.body.innerText.substring(0, 500));
  
  const selectors = [
    '[role="group"]',
    '[class*="question"]',
    '[class*="quiz"]',
    '[class*="assessment"]',
    '[data-test*="question"]',
    'fieldset',
    'h1, h2, h3, h4, h5, h6',
    'p',
    'div[class*="text"]',
    'div',
    'span',
    'label'
  ];
  
  const questionPatterns = [
    /\?$/,
    /\?/,
    /^(what|when|where|who|why|how|which|is|are|does|do|did|can|could|would|should|will|shall)/i,
    /\d+\.\s*[A-Z]/,
    /^(true|false)/i,
    /characteristics/i,
    /deployment model/i
  ];
  
  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    console.log(`DEBUG: Found ${elements.length} elements for selector "${selector}"`);
    
    elements.forEach(el => {
      const text = el.textContent.trim();
      
      if (text.length < 10 || text.length > 1000 || seenTexts.has(text)) {
        return;
      }
      
      for (const pattern of questionPatterns) {
        if (pattern.test(text)) {
          seenTexts.add(text);
          questions.push({
            text: text,
            element: el
          });
          console.log('Found question:', text.substring(0, 100));
          break;
        }
      }
    });
  });
  
  if (questions.length === 0) {
    console.log('DEBUG: No questions found. Logging first 10 p elements:');
    const pElements = document.querySelectorAll('p');
    Array.from(pElements).slice(0, 10).forEach((el, i) => {
      console.log(`  p[${i}]:`, el.textContent.substring(0, 100));
    });
    
    console.log('DEBUG: Logging first 10 divs with text:');
    const divs = document.querySelectorAll('div');
    let count = 0;
    for (const div of divs) {
      const text = div.textContent.trim();
      if (text.length > 20 && text.length < 200) {
        console.log(`  div[${count}]:`, text.substring(0, 100));
        count++;
        if (count >= 10) break;
      }
    }
  }
  
  return questions;
}

// Function to find potential answer choices
function findAnswerChoices(questionElement) {
  const answers = [];
  const seenTexts = new Set();
  let inputType = null; // 'radio' or 'checkbox'
  
  let container = questionElement.closest('[role="group"], fieldset, form, [class*="question"], div[class*="options"]');
  if (!container) {
    container = questionElement.parentElement;
  }
  
  for (let i = 0; i < 3 && container && answers.length === 0; i++) {
    container = container.parentElement;
    if (!container) break;
  }
  
  if (!container) container = document.body;
  
  const answerSelectors = [
    'input[type="radio"]',
    'input[type="checkbox"]',
    'button[role="radio"]',
    'button[role="checkbox"]',
    '[role="option"]',
    '[class*="answer"]',
    '[class*="option"]',
    '[class*="choice"]',
    '[data-test*="answer"]',
    '[data-test*="option"]',
    'label',
    'li'
  ];
  
  const excludePatterns = [
    /^question\s+\d+\s+of\s+\d+$/i,
    /^page\s+\d+/i,
    /^next$/i,
    /^previous$/i,
    /^submit$/i,
    /^skip$/i,
    /^back$/i,
    /^continue$/i,
    /^finish$/i,
    /^review$/i,
    /^\d+\s*\/\s*\d+$/,
    /^score:/i,
    /^time:/i,
    /^remaining:/i
  ];
  
  answerSelectors.forEach(selector => {
    const elements = container.querySelectorAll(selector);
    
    elements.forEach(el => {
      let text = el.textContent.trim();
      
      // Detect input type from actual input elements
      if (el.tagName === 'INPUT') {
        if (el.type === 'radio') {
          inputType = 'radio';
        } else if (el.type === 'checkbox') {
          inputType = 'checkbox';
        }
        
        const label = container.querySelector(`label[for="${el.id}"]`);
        if (label) {
          text = label.textContent.trim();
        } else {
          const parentLabel = el.closest('label');
          if (parentLabel) {
            text = parentLabel.textContent.trim();
          }
        }
      }
      
      if (!text || text.length < 2 || text.length > 300 || seenTexts.has(text)) {
        return;
      }
      
      if (excludePatterns.some(pattern => pattern.test(text))) {
        console.log(`Excluding UI element: "${text}"`);
        return;
      }
      
      const wordCount = text.split(/\s+/).length;
      const numberCount = (text.match(/\d+/g) || []).length;
      if (numberCount > wordCount / 2) {
        console.log(`Excluding numeric element: "${text}"`);
        return;
      }
      
      seenTexts.add(text);
      answers.push({
        text: text,
        element: el,
        parentLabel: el.closest('label') || el
      });
    });
  });
  
  console.log(`Found ${answers.length} answer choices (type: ${inputType || 'unknown'})`);
  answers.forEach((a, i) => {
    console.log(`   [${i}] "${a.text.substring(0, 50)}" - Element: ${a.element.tagName}.${a.element.className || 'no-class'}, ID: ${a.element.id || 'no-id'}`);
  });
  
  return { answers, inputType };
}

// Function to determine expected number of answers from question text
function getExpectedAnswerCount(questionText, inputType) {
  if (inputType === 'radio') {
    return 1; // Radio buttons always mean single answer
  }
  
  // For checkboxes, try to find the expected count in the question
  const lowerQuestion = questionText.toLowerCase();
  
  // Look for explicit numbers
  const numberWords = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  
  // Check for patterns like "select two", "choose three", "two factors", etc.
  for (const [word, num] of Object.entries(numberWords)) {
    const patterns = [
      new RegExp(`\\b${word}\\s+(answers?|options?|choices?|factors?|characteristics?|items?|reasons?|ways?|methods?|types?)\\b`, 'i'),
      new RegExp(`\\bselect\\s+${word}\\b`, 'i'),
      new RegExp(`\\bchoose\\s+${word}\\b`, 'i'),
      new RegExp(`\\bpick\\s+${word}\\b`, 'i'),
      new RegExp(`\\bwhich\\s+${word}\\b`, 'i')
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(lowerQuestion)) {
        console.log(`📊 Detected ${num} expected answers from question text`);
        return num;
      }
    }
  }
  
  // Check for digit numbers (e.g., "2 answers", "3 characteristics")
  const digitMatch = lowerQuestion.match(/\b(\d+)\s+(answers?|options?|choices?|factors?|characteristics?|items?|reasons?|ways?|methods?|types?)\b/i);
  if (digitMatch) {
    const count = parseInt(digitMatch[1]);
    console.log(`📊 Detected ${count} expected answers from question text`);
    return count;
  }
  
  // Check for "Each correct answer" or "select all that apply" - means multiple but unknown count
  if (/each correct answer|select all that apply|all that apply|select all|choose all/i.test(lowerQuestion)) {
    console.log(`📊 Detected "select all" question - expecting multiple answers`);
    return -1; // Special value meaning "multiple, unknown count"
  }
  
  // Default for checkboxes: assume multiple but we don't know how many
  console.log(`📊 Checkbox question with no specific count mentioned`);
  return -1;
}

// Function to get answer using OpenAI
async function getAnswerFromOpenAI(question, answerChoices, inputType, expectedCount) {
  if (!openaiApiKey) {
    console.error('❌ No API key available');
    return null;
  }
  
  try {
    console.log('🤖 Asking ChatGPT...');
    
    const choicesText = answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join('\n');
    
    let instructions = '';
    if (inputType === 'radio') {
      instructions = '- This is a SINGLE-ANSWER question (radio buttons). Provide exactly ONE letter.';
    } else if (expectedCount > 0) {
      instructions = `- This is a MULTIPLE-ANSWER question (checkboxes). Provide exactly ${expectedCount} letter(s), separated by commas.`;
    } else if (expectedCount === -1) {
      instructions = '- This is a MULTIPLE-ANSWER question (checkboxes). Provide ALL correct answers, separated by commas.';
    } else {
      instructions = '- Determine if this requires one or multiple answers based on the question wording.';
    }
    
    const prompt = `You are helping with a Microsoft Azure certification exam. Answer the following multiple-choice question by selecting the correct answer(s).

Question: ${question}

Answer choices:
${choicesText}

Instructions:
${instructions}
- Respond ONLY with the letter(s) of the correct answer(s) (e.g., "A" or "A,C,D")
- Do not include any explanation, reasoning, or additional text
- Do not include spaces after commas

Correct answer(s):`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert on Microsoft Azure and cloud computing. You provide only the letter(s) of correct answers to multiple-choice questions, without any explanation.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 20
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ OpenAI API error:', error);
      if (error.error && error.error.message) {
        console.error('Error message:', error.error.message);
      }
      return null;
    }
    
    const data = await response.json();
    const answer = data.choices[0].message.content.trim();
    
    console.log('🤖 ChatGPT says:', answer);
    
    const correctLetters = answer.replace(/\s/g, '').split(',').map(l => l.trim().toUpperCase());
    const correctIndices = correctLetters.map(l => l.charCodeAt(0) - 65).filter(i => i >= 0 && i < answerChoices.length);
    
    // Validate answer count for radio buttons
    if (inputType === 'radio' && correctIndices.length > 1) {
      console.log(`⚠️ Warning: Radio button question but got ${correctIndices.length} answers. Using only the first one.`);
      return [correctIndices[0]];
    }
    
    // Validate answer count for checkboxes with specific count
    if (expectedCount > 0 && correctIndices.length !== expectedCount) {
      console.log(`⚠️ Warning: Expected ${expectedCount} answers but got ${correctIndices.length}`);
    }
    
    return correctIndices;
    
  } catch (error) {
    console.error('❌ Error calling OpenAI:', error);
    return null;
  }
}

// Function to highlight matching answers
function highlightAnswer(element, isCorrect = true) {
  const colorType = isCorrect ? 'correct' : 'unknown';
  console.log(`   🎨 Attempting to highlight as ${colorType}`);
  console.log(`      Original element:`, element);
  
  let targetElement = element;
  
  if (element.tagName === 'INPUT') {
    console.log(`      Element is INPUT, looking for label...`);
    const label = document.querySelector(`label[for="${element.id}"]`) || element.closest('label');
    if (label) {
      targetElement = label;
      console.log(`      Found label:`, label);
    } else {
      targetElement = element.parentElement;
      console.log(`      No label found, using parent:`, targetElement);
    }
  }
  
  // Remove any existing quiz helper classes
  targetElement.classList.remove('quiz-helper-correct', 'quiz-helper-unknown');
  targetElement.removeAttribute('data-quiz-helper-highlight');
  
  // Add the appropriate class
  const className = isCorrect ? 'quiz-helper-correct' : 'quiz-helper-unknown';
  targetElement.classList.add(className);
  targetElement.setAttribute('data-quiz-helper-highlight', 'true');
  targetElement.setAttribute('data-quiz-helper-type', colorType);
  
  console.log(`      ✓ Applied ${colorType} class to:`, targetElement.textContent.substring(0, 50));
  console.log(`      Classes:`, targetElement.className);
}

// Function to remove all highlights
function removeHighlights() {
  const highlighted = document.querySelectorAll('[data-quiz-helper-highlight="true"]');
  highlighted.forEach(el => {
    el.classList.remove('quiz-helper-correct', 'quiz-helper-unknown');
    el.removeAttribute('data-quiz-helper-highlight');
    el.removeAttribute('data-quiz-helper-type');
  });
  console.log(`Removed ${highlighted.length} highlights`);
}

// Main scanning function
async function scanAndHighlight() {
  if (isProcessing || !extensionEnabled) return;
  
  if (!openaiApiKey) {
    console.error('❌ Cannot scan: No OpenAI API key. Please add one in the extension popup.');
    return;
  }
  
  isProcessing = true;
  console.log('Starting scan...');
  
  try {
    const questions = findQuestions();
    console.log(`Found ${questions.length} potential questions`);
    
    if (questions.length === 0) {
      console.log('No questions found. Page might still be loading or uses unsupported format.');
      isProcessing = false;
      return;
    }
    
    const questionsToProcess = questions.slice(0, 10);
    
    for (const question of questionsToProcess) {
      if (processedQuestions.has(question.text)) {
        continue;
      }
      
      processedQuestions.add(question.text);
      
      const { answers: answerChoices, inputType } = findAnswerChoices(question.element);
      
      if (answerChoices.length === 0) {
        console.log('No answer choices found for question');
        continue;
      }
      
      const expectedCount = getExpectedAnswerCount(question.text, inputType);
      
      console.log(`\n📝 Question: ${question.text.substring(0, 100)}...`);
      console.log(`   Input type: ${inputType || 'unknown'}`);
      console.log(`   Expected answers: ${expectedCount === -1 ? 'multiple (unknown count)' : expectedCount}`);
      console.log(`   Answer choices (${answerChoices.length}):`);
      answerChoices.forEach((c, i) => {
        console.log(`   ${String.fromCharCode(65 + i)}. ${c.text.substring(0, 50)}`);
      });
      
      const correctIndices = await getAnswerFromOpenAI(question.text, answerChoices, inputType, expectedCount);
      
      if (correctIndices && correctIndices.length > 0) {
        console.log(`✅ ChatGPT identified ${correctIndices.length} correct answer(s):`);
        
        let highlightedCount = 0;
        correctIndices.forEach(index => {
          if (index >= 0 && index < answerChoices.length) {
            const choice = answerChoices[index];
            console.log(`   ✓ ${String.fromCharCode(65 + index)}. ${choice.text}`);
            console.log(`      Element type: ${choice.element.tagName}, class: ${choice.element.className}`);
            
            try {
              highlightAnswer(choice.element, true);
              highlightedCount++;
              console.log(`      ✓ Successfully highlighted`);
            } catch (e) {
              console.error(`      ❌ Failed to highlight:`, e);
            }
          } else {
            console.error(`   ❌ Invalid index ${index} (max: ${answerChoices.length - 1})`);
          }
        });
        
        if (highlightedCount === 0) {
          console.error('⚠️ WARNING: ChatGPT provided answers but NONE were highlighted!');
          console.log('⚠️ Falling back to RED highlighting (user must guess)');
          answerChoices.forEach((choice, index) => {
            console.log(`   ⚠️ ${String.fromCharCode(65 + index)}. ${choice.text} (HIGHLIGHT FAILED)`);
            try {
              highlightAnswer(choice.element, false);
            } catch (e) {
              console.error(`      ❌ Failed to highlight in red:`, e);
            }
          });
        } else if (highlightedCount < correctIndices.length) {
          console.warn(`⚠️ WARNING: Only ${highlightedCount} of ${correctIndices.length} answers were highlighted`);
        }
        
      } else {
        console.log('❌ ChatGPT failed to provide an answer - highlighting all choices in RED');
        console.log('⚠️ USER MUST GUESS - ChatGPT could not determine the correct answer');
        // Highlight all answers in red to indicate user needs to make a guess
        answerChoices.forEach((choice, index) => {
          console.log(`   ⚠️ ${String.fromCharCode(65 + index)}. ${choice.text} (UNKNOWN)`);
          try {
            highlightAnswer(choice.element, false);
          } catch (e) {
            console.error(`      ❌ Failed to highlight:`, e);
          }
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\n✅ Scan complete');
  } catch (error) {
    console.error('Error in scanAndHighlight:', error);
  } finally {
    isProcessing = false;
  }
}

// Watch for dynamic content changes
let mutationTimeout;
const observer = new MutationObserver((mutations) => {
  if (!extensionEnabled || isProcessing) return;
  
  const hasNewContent = mutations.some(mutation => {
    return mutation.addedNodes.length > 0 && 
           Array.from(mutation.addedNodes).some(node => 
             node.nodeType === 1 && node.textContent.length > 50
           );
  });
  
  if (hasNewContent) {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(() => {
      console.log('Content changed, rescanning...');
      scanAndHighlight();
    }, 2000);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
