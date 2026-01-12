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
      border: 3px solid #28a745 !important;
      box-shadow: 0 0 8px rgba(40, 167, 69, 0.5) !important;
      border-radius: 4px !important;
      transition: all 0.3s ease !important;
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
  } else if (request.action === 'retryScan') {
    console.log('🔄 Manual retry initiated from popup');
    processedQuestions.clear();
    isProcessing = false;
    removeHighlights();
    waitForContentAndScan();
  }
});

// Wait for dynamic content to load - ENHANCED for Microsoft Learn
function waitForContentAndScan() {
  console.log('🔍 Waiting for Microsoft Learn quiz content to load...');
  
  let attempts = 0;
  const maxAttempts = 60;
  
  const checkContent = setInterval(() => {
    attempts++;
    
    const mainColumn = document.querySelector('[data-main-column]');
    const hasMainContent = mainColumn && mainColumn.innerText.length > 100;
    const hasQuizElements = document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
    const hasQuestionText = document.body.innerText.length > 500;
    const hasAssessmentContainer = document.querySelector('[class*="assessment"], [class*="question"], [role="group"]');
    const hasInteractiveElements = document.querySelectorAll('button, input, label').length > 5;
    const reactRoot = document.querySelector('#root, [data-reactroot], [data-react-app]');
    const hasReactContent = reactRoot && reactRoot.innerText.length > 200;
    
    const contentLoaded = (hasMainContent && hasQuizElements) || 
                         (hasQuestionText && hasQuizElements) ||
                         (hasReactContent && hasQuizElements);
    
    console.log(`Attempt ${attempts}/${maxAttempts}: main=${hasMainContent}, quiz=${hasQuizElements}, react=${hasReactContent}`);
    
    if (contentLoaded) {
      clearInterval(checkContent);
      console.log('✅ Microsoft Learn quiz content detected! Starting scan in 3 seconds...');
      setTimeout(() => scanAndHighlight(), 3000);
    } else if (attempts >= maxAttempts) {
      clearInterval(checkContent);
      console.log('⚠️ Timeout: Quiz content did not load within expected time.');
    }
  }, 500);
}

// Function to clean and extract pure question text
function cleanQuestionText(text) {
  // Remove common prefixes that don't add value
  let cleaned = text
    .replace(/^Question \d+\s*[:.]?\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^Q\d+\s*[:.]?\s*/i, '')
    .trim();
  
  return cleaned;
}

// Function to get full question context including scenario descriptions
function getFullQuestionContext(questionElement) {
  let questionText = questionElement.textContent.trim();
  questionText = cleanQuestionText(questionText);
  
  const contextParts = [];
  
  // Check previous siblings for context (scenario descriptions, requirements)
  let prevSibling = questionElement.previousElementSibling;
  let attempts = 0;
  
  while (prevSibling && attempts < 5) {
    const text = prevSibling.textContent.trim();
    
    if (text.length > 30 && text.length < 2000 && !text.match(/question \d+|^\d+\s*of\s*\d+/i)) {
      const hasContextKeywords = /scenario|requirement|company|organization|need|must|should|environment|architecture|implement|deploy|configure|planning|contoso|fabrikam|adatum|you have|you are|you plan|you create/i.test(text);
      
      if (hasContextKeywords || text.length > 100) {
        contextParts.unshift(text);
      }
    }
    
    prevSibling = prevSibling.previousElementSibling;
    attempts++;
  }
  
  // Check parent containers for broader context
  let parent = questionElement.parentElement;
  attempts = 0;
  while (parent && attempts < 3) {
    const parentText = parent.textContent.trim();
    if (parentText.length > questionText.length + 50 && parentText.length < 3000) {
      const extraContext = parentText.replace(questionText, '').trim();
      if (extraContext.length > 50 && /scenario|requirement|company|organization/i.test(extraContext)) {
        contextParts.unshift(extraContext.substring(0, 500));
        break;
      }
    }
    parent = parent.parentElement;
    attempts++;
  }
  
  if (contextParts.length > 0) {
    const fullContext = contextParts.join('\n\n') + '\n\n' + questionText;
    console.log('📋 Added context from surrounding elements');
    return fullContext;
  }
  
  return questionText;
}

// Enhanced question finding for Microsoft Learn - Groups multi-line questions
function findQuestions() {
  const questions = [];
  const seenTexts = new Set();
  
  console.log('🔍 Scanning page structure...');
  
  // Look for question CONTAINERS first, not individual text elements
  const containerSelectors = [
    '[role="group"]',
    '[class*="question-container"]',
    '[class*="question-block"]',
    '[class*="assessment"]',
    'fieldset',
    '[data-test*="question"]'
  ];
  
  // Try to find question containers that hold the full multi-line question
  for (const selector of containerSelectors) {
    const containers = document.querySelectorAll(selector);
    
    containers.forEach(container => {
      // Get ALL text content from the container as ONE question
      const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (inputs.length === 0) return; // Skip if no answer choices
      
      // Find the question text part (everything before the answer choices)
      let questionText = '';
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      let node;
      const answerContainer = inputs[0].closest('label, [class*="answer"], [class*="option"]')?.parentElement;
      
      while (node = walker.nextNode()) {
        const parent = node.parentElement;
        // Stop collecting text once we hit the answers section
        if (answerContainer && answerContainer.contains(parent)) continue;
        if (parent.closest('label[for], [class*="answer"], [class*="option"]')) continue;
        
        const text = node.textContent.trim();
        if (text.length > 2) {
          questionText += text + ' ';
        }
      }
      
      questionText = questionText.trim();
      
      if (questionText.length < 15 || seenTexts.has(questionText)) return;
      if (/^(next|previous|submit|skip)$/i.test(questionText)) return;
      // Skip page metadata, scripts, and non-question content
      if (/var\s+\w+\s*=\s*\{|function\s*\(|microsoft learn|practice assessment/i.test(questionText)) return;
      
      seenTexts.add(questionText);
      questions.push({
        text: cleanQuestionText(questionText),
        element: container
      });
      console.log('✓ Found question:', questionText.substring(0, 120) + '...');
    });
  }
  
  // Fallback: if no containers found, group by proximity to radio/checkbox inputs
  if (questions.length === 0) {
    const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    const processedContainers = new Set();
    
    inputs.forEach(input => {
      let container = input.closest('[role="group"], fieldset, form, [class*="question"]');
      if (!container) container = input.parentElement?.parentElement?.parentElement;
      if (!container || processedContainers.has(container)) return;
      
      processedContainers.add(container);
      
      // Collect all non-answer text as the question
      let questionText = '';
      const textElements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, span');
      
      textElements.forEach(el => {
        if (el.closest('label') || el.querySelector('input')) return;
        const text = el.textContent.trim();
        if (text.length > 10 && !seenTexts.has(text)) {
          questionText += text + ' ';
        }
      });
      
      questionText = questionText.trim();
      if (questionText.length > 15 && !seenTexts.has(questionText)) {
        seenTexts.add(questionText);
        questions.push({
          text: cleanQuestionText(questionText),
          element: container
        });
      }
    });
  }
  
  return questions;
}

// Enhanced answer choice finding - strictly finds only radio/checkbox options
function findAnswerChoices(questionElement) {
  const answers = [];
  const seenTexts = new Set();
  let inputType = null;
  
  // Find the container with radio/checkbox inputs
  let container = questionElement;
  for (let i = 0; i < 6 && container; i++) {
    const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (inputs.length > 0) {
      break;
    }
    container = container.parentElement;
  }
  
  if (!container) container = document.body;
  
  // Get all radio/checkbox inputs - these are the ONLY valid answer choices
  const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
  console.log(`   Found ${inputs.length} radio/checkbox inputs`);
  
  inputs.forEach((input, idx) => {
    if (input.type === 'radio') inputType = 'radio';
    else if (input.type === 'checkbox') inputType = 'checkbox';
    
    let text = '';
    let labelElement = null;
    
    // Strategy 1: Find label with matching 'for' attribute
    if (input.id) {
      labelElement = document.querySelector(`label[for="${input.id}"]`);
      if (labelElement) {
        text = labelElement.textContent.trim();
      }
    }
    
    // Strategy 2: Find parent label
    if (!text) {
      labelElement = input.closest('label');
      if (labelElement) {
        text = labelElement.textContent.trim();
      }
    }
    
    // Strategy 3: Find adjacent sibling text
    if (!text) {
      const parent = input.parentElement;
      if (parent) {
        // Clone and remove the input to get just the text
        const clone = parent.cloneNode(true);
        const inputClone = clone.querySelector('input');
        if (inputClone) inputClone.remove();
        text = clone.textContent.trim();
      }
    }
    
    // Strategy 4: Check next sibling
    if (!text && input.nextSibling) {
      text = input.nextSibling.textContent?.trim() || '';
    }
    
    // Skip if no text found or duplicate
    if (!text || text.length < 1) {
      console.log(`   Skipping input ${idx} - no text found`);
      return;
    }
    
    if (seenTexts.has(text)) {
      console.log(`   Skipping input ${idx} - duplicate text`);
      return;
    }
    
    seenTexts.add(text);
    answers.push({
      text: text,
      element: input,
      parentLabel: labelElement || input.parentElement
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

// ENHANCED OpenAI call with improved prompting and reasoning
async function getAnswerFromOpenAI(question, answerChoices, inputType, expectedCount) {
  if (!openaiApiKey) {
    console.error('❌ No API key available');
    return null;
  }
  
  try {
    console.log('🤖 Querying GPT-4o with enhanced prompt...');
    
    const choicesText = answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c.text}`).join('\n');
    
    let instructions = '';
    let answerCount = '';
    
    if (inputType === 'radio') {
      instructions = `This is a SINGLE-ANSWER question (radio buttons).`;
      answerCount = 'You MUST select EXACTLY ONE option.';
    } else if (expectedCount > 0) {
      instructions = `This is a MULTIPLE-ANSWER question requiring EXACTLY ${expectedCount} answer(s).`;
      answerCount = `You MUST select EXACTLY ${expectedCount} option(s), no more, no less.`;
    } else if (expectedCount === -1) {
      instructions = `This is a "SELECT ALL THAT APPLY" question.`;
      answerCount = 'Select ALL correct options. There are typically 2-4 correct answers.';
    }
    
    // ENHANCED system prompt with more specific Azure knowledge
    const systemPrompt = `You are a Microsoft Azure expert preparing someone for Azure certification exams. You have deep, practical knowledge of:

AZURE FUNDAMENTALS (AZ-900):
- Cloud concepts: IaaS, PaaS, SaaS, public/private/hybrid cloud
- Core Azure services: Compute (VMs, App Service, Functions, AKS), Storage (Blob, Files, Disk, Archive), Networking (VNet, VPN, ExpressRoute), Databases (SQL DB, Cosmos DB)
- Azure management: Portal, CLI, PowerShell, ARM templates, Azure Resource Manager
- Security: Azure AD/Entra ID, RBAC, MFA, Security Center, Key Vault, NSGs
- Pricing: Subscriptions, resource groups, cost management, TCO calculator, pricing calculator
- Governance: Azure Policy, Blueprints, Management Groups, Tags
- Compliance: Trust Center, compliance offerings, data residency

DECISION PRINCIPLES:
1. Microsoft ALWAYS recommends PaaS over IaaS when possible (more managed, less overhead)
2. For serverless: Azure Functions > Logic Apps for code-based logic
3. For storage: Blob for unstructured data, Azure Files for SMB shares, Disk for VMs
4. For databases: SQL Database for relational, Cosmos DB for globally distributed NoSQL
5. For identity: Azure AD/Entra ID is the central identity service
6. For security: Defense in depth - use multiple layers (NSG, firewalls, encryption)
7. For cost optimization: Reserved instances, spot VMs, auto-scaling, Azure Advisor recommendations
8. For high availability: Availability Zones > Availability Sets > single VMs
9. For hybrid: ExpressRoute > VPN for predictable performance and higher bandwidth
10. For compliance: Choose regions based on data residency requirements

When answering:
- Consider the Well-Architected Framework: Cost Optimization, Operational Excellence, Performance Efficiency, Reliability, Security
- Think about what Microsoft would recommend in official documentation
- For "select all" questions, be thorough - multiple answers are usually correct
- Pay attention to key words: "cheapest" = lower tier, "most secure" = multiple layers, "fastest" = premium tiers`;

    const userPrompt = `${instructions}
${answerCount}

QUESTION:
${question}

OPTIONS:
${choicesText}

ANALYSIS STEPS:
1. Identify the core requirement (cost, security, performance, compliance, etc.)
2. Eliminate obviously wrong answers
3. Consider Microsoft best practices and official recommendations
4. For each remaining option, evaluate against Azure principles
5. Choose the answer(s) that Microsoft would recommend

Think carefully and provide your answer.

FORMAT: Always respond with "ANSWER: " followed by the LETTER(s) of the correct option(s) (A, B, C, D, etc.), separated by commas if multiple. Never respond with numbers - always use letters to indicate which option is correct.`;

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
        temperature: 0.2,  // Lowered for more consistent, confident answers
        max_tokens: 800,
        top_p: 0.95  // Added for better quality
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ OpenAI API error:', error);
      
      // Check for rate limit error (status 429 or error code)
      if (response.status === 429 || error?.error?.type === 'rate_limit_exceeded' || error?.error?.code === 'rate_limit_exceeded') {
        console.log('⚠️ Rate limit detected, will retry with backoff');
        return 'RATE_LIMITED';
      }
      
      return null;
    }
    
    const data = await response.json();
    const fullResponse = data.choices[0].message.content.trim();
    
    console.log('🤖 GPT-4o response:', fullResponse.substring(0, 400));
    
    // Extract answer with multiple strategies
    let answer = null;
    
    // Strategy 1: Look for "ANSWER:" format
    const answerMatch = fullResponse.match(/ANSWER:\s*([A-Z](?:,\s*[A-Z])*)/i);
    if (answerMatch) {
      answer = answerMatch[1];
    } else {
      // Strategy 2: Look for common answer patterns
      const patterns = [
        /(?:correct|answer|select).*?:\s*([A-Z](?:,\s*[A-Z])*)/i,
        /(?:therefore|thus|so).*?([A-Z](?:,\s*[A-Z])*)\s*$/i,
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
    
    // Strict validation
    if (inputType === 'radio' && correctIndices.length > 1) {
      console.log(`⚠️ Radio button but got ${correctIndices.length} answers - using first only`);
      return [correctIndices[0]];
    }
    
    if (expectedCount > 0 && correctIndices.length !== expectedCount) {
      console.log(`⚠️ Expected ${expectedCount} answers but got ${correctIndices.length}`);
      // If GPT gave wrong count for a specific-count question, this might indicate uncertainty
      // But we'll still use what it gave us
    }
    
    if (correctIndices.length === 0) {
      console.error('❌ No valid answer indices extracted');
      return null;
    }
    
    return correctIndices;
    
  } catch (error) {
    console.error('❌ OpenAI error:', error);
    return null;
  }
}

// Retry wrapper with exponential backoff for rate limits
async function getAnswerWithRetry(question, answerChoices, inputType, expectedCount, retries = 5) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await getAnswerFromOpenAI(question, answerChoices, inputType, expectedCount);
      
      if (result === 'RATE_LIMITED') {
        const backoffMs = Math.min(1000 * Math.pow(2, i), 60000); // Max 60 seconds
        console.log(`⏳ Rate limited. Waiting ${backoffMs / 1000}s before retry ${i + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      
      if (result && result.length > 0) {
        return result;
      }
      if (i < retries) {
        console.log(`⚠️ Attempt ${i + 1} failed or returned no answer, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
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
  
  targetElement.classList.remove('quiz-helper-correct');
  targetElement.classList.add('quiz-helper-correct');
  targetElement.setAttribute('data-quiz-helper-highlight', 'true');
}

// Remove highlights
function removeHighlights() {
  const highlighted = document.querySelectorAll('[data-quiz-helper-highlight="true"]');
  highlighted.forEach(el => {
    el.classList.remove('quiz-helper-correct');
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
  console.log('🚀 Starting enhanced scan with GPT-4o...');
  console.log('📊 Improvements: Lower temperature, enhanced Azure knowledge, better answer extraction');
  
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
        console.log('⚠️ AI could not determine answer - no highlighting applied');
      }
      
      // Slightly longer delay to avoid rate limits and allow for higher quality responses
      await new Promise(resolve => setTimeout(resolve, 3500));
    }
    
    console.log('\n✅ Scan complete!');
  } catch (error) {
    console.error('❌ Scan error:', error);
  } finally {
    isProcessing = false;
  }
}

// Mutation observer for dynamic content - ignores self-triggered changes
let mutationTimeout;
const observer = new MutationObserver((mutations) => {
  if (!extensionEnabled || isProcessing) return;
  
  const hasNewContent = mutations.some(mutation => {
    return mutation.addedNodes.length > 0 && 
           Array.from(mutation.addedNodes).some(node => 
             node.nodeType === 1 && 
             node.textContent.length > 50 &&
             !node.classList?.contains('quiz-helper-correct') &&
             !node.hasAttribute?.('data-quiz-helper-highlight')
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

// Listen for page navigation (Next button clicks)
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log('🔄 Page navigation detected, resetting and rescanning...');
    processedQuestions.clear();
    isProcessing = false;
    setTimeout(() => waitForContentAndScan(), 1000);
  }
});

urlObserver.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (browser back/forward)
window.addEventListener('popstate', () => {
  console.log('🔄 Browser navigation detected, resetting and rescanning...');
  processedQuestions.clear();
  isProcessing = false;
  setTimeout(() => waitForContentAndScan(), 1000);
});

// Listen for Next button clicks
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target.tagName === 'SPAN' && target.textContent.trim() === 'Next') {
    console.log('🔄 Next button clicked, scanning in 1 second...');
    setTimeout(() => {
      processedQuestions.clear();
      isProcessing = false;
      removeHighlights();
      waitForContentAndScan();
    }, 1000);
  }
});
