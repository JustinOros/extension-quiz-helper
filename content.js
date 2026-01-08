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

// Wait for dynamic content to load - ENHANCED for Microsoft Learn
function waitForContentAndScan() {
  console.log('🔍 Waiting for Microsoft Learn quiz content to load...');
  
  let attempts = 0;
  const maxAttempts = 60; // Increased for slower loading
  
  const checkContent = setInterval(() => {
    attempts++;
    
    // Microsoft Learn specific selectors
    const mainColumn = document.querySelector('[data-main-column]');
    const hasMainContent = mainColumn && mainColumn.innerText.length > 100;
    
    // Look for Microsoft Learn quiz elements
    const hasQuizElements = document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
    const hasQuestionText = document.body.innerText.length > 500;
    
    // Look for common Microsoft Learn assessment structures
    const hasAssessmentContainer = document.querySelector('[class*="assessment"], [class*="question"], [role="group"]');
    const hasInteractiveElements = document.querySelectorAll('button, input, label').length > 5;
    
    // Check for React root (Microsoft Learn uses React)
    const reactRoot = document.querySelector('#root, [data-reactroot], [data-react-app]');
    const hasReactContent = reactRoot && reactRoot.innerText.length > 200;
    
    const contentLoaded = (hasMainContent && hasQuizElements) || 
                         (hasQuestionText && hasQuizElements) ||
                         (hasReactContent && hasQuizElements);
    
    console.log(`Attempt ${attempts}/${maxAttempts}: main=${hasMainContent}, quiz=${hasQuizElements}, assessment=${!!hasAssessmentContainer}, react=${hasReactContent}`);
    
    if (contentLoaded) {
      clearInterval(checkContent);
      console.log('✅ Microsoft Learn quiz content detected! Starting scan in 3 seconds...');
      setTimeout(() => scanAndHighlight(), 3000);
    } else if (attempts >= maxAttempts) {
      clearInterval(checkContent);
      console.log('⚠️ Timeout: Quiz content did not load within expected time.');
      console.log('💡 Try: 1) Refresh the page, 2) Wait for quiz to fully load, 3) Click "Start" if needed');
    }
  }, 500);
}

// Function to get full question context including scenario descriptions
function getFullQuestionContext(questionElement) {
  let fullText = questionElement.textContent.trim();
  
  // Check previous siblings for context (scenario descriptions, requirements)
  let prevSibling = questionElement.previousElementSibling;
  let attempts = 0;
  const contextParts = [];
  
  while (prevSibling && attempts < 5) {
    const text = prevSibling.textContent.trim();
    
    // If it's a substantial paragraph that adds context
    if (text.length > 30 && text.length < 2000 && !text.match(/question \d+|^\d+\s*of\s*\d+/i)) {
      // Check if it looks like contextual information
      const hasContextKeywords = /scenario|requirement|company|organization|need|must|should|environment|architecture|implement|deploy|configure|planning|contoso|fabrikam|adatum/i.test(text);
      
      if (hasContextKeywords || text.length > 100) {
        contextParts.unshift(text);
      }
    }
    
    prevSibling = prevSibling.previousElementSibling;
    attempts++;
  }
  
  // Also check parent containers for context
  let parent = questionElement.parentElement;
  attempts = 0;
  while (parent && attempts < 3) {
    const parentText = parent.textContent.trim();
    if (parentText.length > fullText.length + 50 && parentText.length < 3000) {
      // This parent might have additional context
      const extraContext = parentText.replace(fullText, '').trim();
      if (extraContext.length > 50 && /scenario|requirement|company|organization/i.test(extraContext)) {
        contextParts.unshift(extraContext.substring(0, 500));
        break;
      }
    }
    parent = parent.parentElement;
    attempts++;
  }
  
  if (contextParts.length > 0) {
    fullText = contextParts.join('\n\n') + '\n\n' + fullText;
    console.log('📋 Added context from surrounding elements');
  }
  
  return fullText;
}

// Enhanced question finding for Microsoft Learn
function findQuestions() {
  const questions = [];
  const seenTexts = new Set();
  
  console.log('🔍 Scanning page structure...');
  console.log('   Total page text length:', document.body.innerText.length);
  
  // Microsoft Learn specific selectors (prioritized)
  const microsoftLearnSelectors = [
    '[role="group"]',
    '[class*="assessment"]',
    '[class*="question"]',
    '[data-test*="question"]',
    'fieldset',
    'form'
  ];
  
  // Generic selectors as fallback
  const genericSelectors = [
    'h1, h2, h3, h4, h5, h6',
    'p',
    'div[class*="text"]',
    'div[class*="content"]',
    'div',
    'span',
    'label'
  ];
  
  const allSelectors = [...microsoftLearnSelectors, ...genericSelectors];
  
  const questionPatterns = [
    /\?$/,                                    // Ends with question mark
    /\?\s*$/,                                 // Ends with question mark and whitespace
    /^(what|when|where|who|why|how|which|is|are|does|do|did|can|could|would|should|will|shall|must)/i,
    /you need to/i,
    /which of the following/i,
    /select.*correct/i,
    /choose.*answer/i,
    /characteristics/i,
    /deployment model/i,
    /recommend/i,
    /solution/i,
    /ensure that/i,
    /minimize/i,
    /configure/i,
    /implement/i
  ];
  
  allSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    
    elements.forEach(el => {
      const text = el.textContent.trim();
      
      // Skip very short or very long text, or duplicates
      if (text.length < 15 || text.length > 1500 || seenTexts.has(text)) {
        return;
      }
      
      // Skip elements that are likely navigation or UI
      if (/^(next|previous|submit|skip|back|continue|finish|review|question \d+ of \d+)$/i.test(text)) {
        return;
      }
      
      // Check against question patterns
      for (const pattern of questionPatterns) {
        if (pattern.test(text)) {
          seenTexts.add(text);
          questions.push({
            text: text,
            element: el
          });
          console.log('✓ Found question:', text.substring(0, 120) + '...');
          break;
        }
      }
    });
  });
  
  // Debug logging if no questions found
  if (questions.length === 0) {
    console.log('⚠️ No questions detected. Debugging page structure...');
    console.log('   Main column:', document.querySelector('[data-main-column]')?.innerText.substring(0, 200));
    console.log('   Input elements:', document.querySelectorAll('input').length);
    console.log('   Radio/Checkbox:', document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length);
    
    const allText = document.body.innerText;
    const lines = allText.split('\n').filter(l => l.trim().length > 20);
    console.log('   First 10 substantial text lines:');
    lines.slice(0, 10).forEach((line, i) => {
      console.log(`     ${i + 1}. ${line.substring(0, 100)}`);
    });
  }
  
  return questions;
}

// Enhanced answer choice finding for Microsoft Learn
function findAnswerChoices(questionElement) {
  const answers = [];
  const seenTexts = new Set();
  let inputType = null;
  
  // Start with the question element's container
  let container = questionElement.closest('[role="group"], fieldset, form, [class*="question"], [class*="answer"], [class*="option"], div');
  
  // Expand search scope if needed
  if (!container || container === questionElement) {
    container = questionElement.parentElement;
  }
  
  // Search up to 4 levels if we haven't found inputs yet
  for (let i = 0; i < 4 && container; i++) {
    const inputsInContainer = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (inputsInContainer.length > 0) {
      console.log(`   Found ${inputsInContainer.length} inputs at level ${i}`);
      break;
    }
    container = container.parentElement;
  }
  
  if (!container) container = document.body;
  
  // Also check siblings
  let nextSibling = questionElement.nextElementSibling;
  let siblingAttempts = 0;
  const siblingContainers = [container];
  
  while (nextSibling && siblingAttempts < 8) {
    siblingContainers.push(nextSibling);
    nextSibling = nextSibling.nextElementSibling;
    siblingAttempts++;
  }
  
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
    /^(next|previous|submit|skip|back|continue|finish|review)$/i,
    /^\d+\s*\/\s*\d+$/,
    /^score:/i,
    /^time:/i,
    /^remaining:/i,
    /^points?:/i
  ];
  
  siblingContainers.forEach(searchContainer => {
    answerSelectors.forEach(selector => {
      const elements = searchContainer.querySelectorAll(selector);
      
      elements.forEach(el => {
        let text = el.textContent.trim();
        
        // Handle input elements specially
        if (el.tagName === 'INPUT') {
          if (el.type === 'radio') {
            inputType = 'radio';
          } else if (el.type === 'checkbox') {
            inputType = 'checkbox';
          }
          
          // Find associated label
          const label = searchContainer.querySelector(`label[for="${el.id}"]`);
          if (label) {
            text = label.textContent.trim();
          } else {
            const parentLabel = el.closest('label');
            if (parentLabel) {
              text = parentLabel.textContent.trim();
            } else {
              // Try to find text near the input
              const parent = el.parentElement;
              if (parent) {
                text = parent.textContent.trim();
              }
            }
          }
        }
        
        // Validation checks
        if (!text || text.length < 2 || text.length > 800 || seenTexts.has(text)) {
          return;
        }
        
        if (excludePatterns.some(pattern => pattern.test(text))) {
          return;
        }
        
        // Exclude if too many numbers (likely not answer text)
        const wordCount = text.split(/\s+/).length;
        const numberCount = (text.match(/\d+/g) || []).length;
        if (wordCount > 2 && numberCount > wordCount / 2) {
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
  });
  
  console.log(`   Found ${answers.length} answer choices (type: ${inputType || 'unknown'})`);
  if (answers.length > 0) {
    console.log('   Answer preview:');
    answers.slice(0, 5).forEach((a, i) => {
      console.log(`     ${String.fromCharCode(65 + i)}. ${a.text.substring(0, 60)}...`);
    });
  }
  
  return { answers, inputType };
}

// Function to determine expected number of answers
function getExpectedAnswerCount(questionText, inputType) {
  if (inputType === 'radio') {
    return 1;
  }
  
  const lowerQuestion = questionText.toLowerCase();
  
  const numberWords = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  
  for (const [word, num] of Object.entries(numberWords)) {
    const patterns = [
      new RegExp(`\\b${word}\\s+(answers?|options?|choices?|factors?|characteristics?|items?|reasons?|ways?|methods?|types?|steps?|actions?|solutions?|components?|services?)\\b`, 'i'),
      new RegExp(`\\bselect\\s+${word}\\b`, 'i'),
      new RegExp(`\\bchoose\\s+${word}\\b`, 'i'),
      new RegExp(`\\bpick\\s+${word}\\b`, 'i'),
      new RegExp(`\\bidentify\\s+${word}\\b`, 'i')
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(lowerQuestion)) {
        console.log(`📊 Detected ${num} expected answers`);
        return num;
      }
    }
  }
  
  const digitMatch = lowerQuestion.match(/\b(\d+)\s+(answers?|options?|choices?|factors?|characteristics?|items?|reasons?|ways?|methods?|types?|steps?|actions?|solutions?)\b/i);
  if (digitMatch) {
    const count = parseInt(digitMatch[1]);
    console.log(`📊 Detected ${count} expected answers`);
    return count;
  }
  
  if (/each correct answer|select all that apply|all that apply|select all|choose all/i.test(lowerQuestion)) {
    console.log(`📊 "Select all that apply" question`);
    return -1;
  }
  
  console.log(`📊 Checkbox question (unknown count)`);
  return -1;
}

// Enhanced OpenAI call with better prompting
async function getAnswerFromOpenAI(question, answerChoices, inputType, expectedCount) {
  if (!openaiApiKey) {
    console.error('❌ No API key available');
    return null;
  }
  
  try {
    console.log('🤖 Querying GPT-4o...');
    
    const choicesText = answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join('\n');
    
    let instructions = '';
    if (inputType === 'radio') {
      instructions = `CRITICAL: This is a SINGLE-ANSWER question (radio buttons).
- You MUST select EXACTLY ONE option
- Even if multiple seem correct, choose the MOST correct one
- Provide only ONE letter in your answer`;
    } else if (expectedCount > 0) {
      instructions = `CRITICAL: This is a MULTIPLE-ANSWER question requiring EXACTLY ${expectedCount} answer(s).
- You MUST select EXACTLY ${expectedCount} option(s), no more, no less
- Evaluate each option independently
- Provide exactly ${expectedCount} letter(s) separated by commas`;
    } else if (expectedCount === -1) {
      instructions = `CRITICAL: This is a "SELECT ALL THAT APPLY" question.
- Carefully evaluate EACH option independently
- Include ALL options that are correct (commonly 2-4 options)
- It's better to include a correct answer than to miss one
- Provide all correct letters separated by commas`;
    }
    
    const systemPrompt = `You are a Microsoft Azure certification expert with deep knowledge of:
- Azure core services (Compute, Storage, Networking, Databases)
- Azure identity and access management (Entra ID, RBAC)
- Azure governance and compliance (Policy, Blueprints, Cost Management)
- Azure security (Security Center, Sentinel, Key Vault)
- Azure monitoring (Monitor, Log Analytics, Application Insights)
- Azure architecture patterns and best practices
- Real-world Azure implementation and troubleshooting

Your expertise comes from years of hands-on Azure experience and Microsoft certification training.

When answering:
1. Consider Microsoft's official recommendations and best practices
2. Think about the Azure Well-Architected Framework (cost, security, reliability, performance, operations)
3. For scenario questions, identify key requirements, constraints, and priorities
4. Choose the MOST Azure-native and recommended solution
5. If multiple answers seem viable, pick the one Microsoft would recommend in their official docs

Example:
Q: Which Azure service provides serverless compute?
Options: A. Azure Virtual Machines B. Azure Functions C. Azure App Service D. Azure Batch
Analysis: Looking for serverless - Azure Functions is the correct answer as it's fully serverless (no VM management)
Answer: B`;

    const userPrompt = `Question:
${question}

Options:
${choicesText}

${instructions}

Think step-by-step:
1. Identify what the question is really asking
2. Consider Azure best practices and official guidance
3. Evaluate each option against the requirements
4. Choose the answer(s) that Microsoft would recommend

Format: ANSWER: [letter(s) only - e.g., "B" or "A,C,D"]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 600
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ OpenAI API error:', error);
      return null;
    }
    
    const data = await response.json();
    const fullResponse = data.choices[0].message.content.trim();
    
    console.log('🤖 GPT-4o response:', fullResponse.substring(0, 300));
    
    // Extract answer
    let answer = null;
    const answerMatch = fullResponse.match(/ANSWER:\s*([A-Z](?:,\s*[A-Z])*)/i);
    if (answerMatch) {
      answer = answerMatch[1];
    } else {
      // Fallback extraction
      const patterns = [
        /(?:correct|answer|select).*?:\s*([A-Z](?:,\s*[A-Z])*)/i,
        /\b([A-Z](?:,\s*[A-Z])*)\s*$/,
        /\b([A-Z](?:,\s*[A-Z])*)\b/
      ];
      
      for (const pattern of patterns) {
        const match = fullResponse.match(pattern);
        if (match) {
          answer = match[1];
          break;
        }
      }
    }
    
    if (!answer) {
      console.error('❌ Could not extract answer from response');
      return null;
    }
    
    console.log('🎯 Extracted answer:', answer);
    
    const correctLetters = answer.replace(/\s/g, '').split(',').map(l => l.trim().toUpperCase());
    const correctIndices = correctLetters
      .map(l => l.charCodeAt(0) - 65)
      .filter(i => i >= 0 && i < answerChoices.length);
    
    // Validation
    if (inputType === 'radio' && correctIndices.length > 1) {
      console.log(`⚠️ Radio button but got ${correctIndices.length} answers - using first only`);
      return [correctIndices[0]];
    }
    
    if (expectedCount > 0 && correctIndices.length !== expectedCount) {
      console.log(`⚠️ Expected ${expectedCount} answers but got ${correctIndices.length}`);
    }
    
    return correctIndices;
    
  } catch (error) {
    console.error('❌ OpenAI error:', error);
    return null;
  }
}

// Retry wrapper
async function getAnswerWithRetry(question, answerChoices, inputType, expectedCount, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await getAnswerFromOpenAI(question, answerChoices, inputType, expectedCount);
      if (result && result.length > 0) {
        return result;
      }
      if (i < retries) {
        console.log(`⚠️ Attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`❌ Attempt ${i + 1} error:`, error);
      if (i === retries) return null;
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
  return null;
}

// Highlighting function
function highlightAnswer(element, isCorrect = true) {
  let targetElement = element;
  
  if (element.tagName === 'INPUT') {
    const label = document.querySelector(`label[for="${element.id}"]`) || element.closest('label');
    targetElement = label || element.parentElement;
  }
  
  targetElement.classList.remove('quiz-helper-correct', 'quiz-helper-unknown');
  const className = isCorrect ? 'quiz-helper-correct' : 'quiz-helper-unknown';
  targetElement.classList.add(className);
  targetElement.setAttribute('data-quiz-helper-highlight', 'true');
}

// Remove highlights
function removeHighlights() {
  const highlighted = document.querySelectorAll('[data-quiz-helper-highlight="true"]');
  highlighted.forEach(el => {
    el.classList.remove('quiz-helper-correct', 'quiz-helper-unknown');
    el.removeAttribute('data-quiz-helper-highlight');
  });
  console.log(`Removed ${highlighted.length} highlights`);
}

// Main scan function
async function scanAndHighlight() {
  if (isProcessing || !extensionEnabled || !openaiApiKey) {
    if (!openaiApiKey) console.error('❌ No API key configured');
    return;
  }
  
  isProcessing = true;
  console.log('🚀 Starting enhanced Microsoft Learn scan...');
  
  try {
    const questions = findQuestions();
    console.log(`📝 Found ${questions.length} questions`);
    
    if (questions.length === 0) {
      console.log('⚠️ No questions detected. Ensure quiz is loaded and try again.');
      isProcessing = false;
      return;
    }
    
    for (const question of questions.slice(0, 10)) {
      if (processedQuestions.has(question.text)) continue;
      
      processedQuestions.add(question.text);
      
      const fullQuestionText = getFullQuestionContext(question.element);
      const { answers: answerChoices, inputType } = findAnswerChoices(question.element);
      
      if (answerChoices.length === 0) {
        console.log('⚠️ No answer choices found, skipping question');
        continue;
      }
      
      const expectedCount = getExpectedAnswerCount(fullQuestionText, inputType);
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📝 QUESTION: ${question.text.substring(0, 150)}...`);
      console.log(`   Type: ${inputType || 'unknown'} | Expected: ${expectedCount === -1 ? 'multiple' : expectedCount}`);
      console.log(`   Choices: ${answerChoices.length}`);
      
      const correctIndices = await getAnswerWithRetry(fullQuestionText, answerChoices, inputType, expectedCount);
      
      if (correctIndices && correctIndices.length > 0) {
        console.log(`✅ AI Answer: ${correctIndices.map(i => String.fromCharCode(65 + i)).join(', ')}`);
        
        correctIndices.forEach(index => {
          if (index >= 0 && index < answerChoices.length) {
            try {
              highlightAnswer(answerChoices[index].element, true);
              console.log(`   ✓ Highlighted: ${answerChoices[index].text.substring(0, 60)}`);
            } catch (e) {
              console.error(`   ❌ Highlight failed:`, e);
            }
          }
        });
      } else {
        console.log('❌ AI could not determine answer - marking all RED');
        answerChoices.forEach(choice => {
          try {
            highlightAnswer(choice.element, false);
          } catch (e) {}
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log('\n✅ Scan complete!');
  } catch (error) {
    console.error('❌ Scan error:', error);
  } finally {
    isProcessing = false;
  }
}

// Mutation observer for dynamic content
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
      console.log('🔄 New content detected, rescanning...');
      scanAndHighlight();
    }, 2000);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
