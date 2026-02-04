/**
 * Script injected into preview iframe for element selection
 * This runs in the iframe's context and communicates with parent via postMessage
 */

import { HMR_PROXY_SCRIPT } from './hmr-proxy-script';

// Check if WebSocket proxy is enabled (from env or parent window)
const USE_WS_PROXY = typeof window !== 'undefined' &&
  (window as any).__HATCHWAY_USE_WS_PROXY === true;

export const SELECTION_SCRIPT = `
(function() {

  // Selection state - DORMANT by default
  let isInspectorActive = false;
  let inspectorStyle = null;
  let highlightedElement = null;
  let highlightOverlay = null;
  let mouseHandler = null;
  let clickHandler = null;

  function getProxyPrefix() {
    try {
      var parts = window.location.pathname.split('/').filter(Boolean);
      var projectsIndex = parts.indexOf('projects');
      if (projectsIndex === -1) {
        return null;
      }

      var projectId = parts[projectsIndex + 1];
      if (!projectId) {
        return null;
      }

      return '/api/projects/' + projectId + '/proxy?path=';
    } catch (error) {
      console.warn('⚠️ [Hatchway CSS] Unable to derive proxy prefix:', error);
      return null;
    }
  }

  var proxyPrefix = getProxyPrefix();

  function rewriteStylesheetHref(link) {
    if (!proxyPrefix || !link) {
      return false;
    }

    var href = link.getAttribute('href');
    if (!href) {
      return false;
    }

    var trimmed = href.trim();

    if (
      trimmed.indexOf('proxy?path=') !== -1 ||
      trimmed.indexOf('http://') === 0 ||
      trimmed.indexOf('https://') === 0 ||
      trimmed.indexOf('//') === 0 ||
      trimmed.indexOf('data:') === 0
    ) {
      return false;
    }

    if (trimmed.charAt(0) === '/') {
      var proxiedHref = proxyPrefix + encodeURIComponent(trimmed);
      if (link.getAttribute('href') !== proxiedHref) {
        link.setAttribute('href', proxiedHref);
        console.log('🎨 [Hatchway CSS] rewrote stylesheet href to proxy:', proxiedHref);
        return true;
      }
    }

    return false;
  }

  // Debug helper: track when stylesheets are added/loaded inside the iframe
  function monitorStylesheets() {
    const loggedLinks = new WeakSet();
    const loggedStyles = new WeakSet();

    const logLink = (link, phase) => {
      if (!link) return;
      const href = link.getAttribute('href') || '(no href)';
      console.log('🎨 [Hatchway CSS]', phase + ' stylesheet:', href);
    };

    const logStyle = (style, phase) => {
      if (!style) return;
      const sample = (style.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
      console.log('🎨 [Hatchway CSS]', phase + ' inline style', sample);
    };

    const attachLinkListeners = (link, phase) => {
      if (!link || loggedLinks.has(link)) return;
      loggedLinks.add(link);
      const rewritten = rewriteStylesheetHref(link);
      const phaseLabel = rewritten ? phase + ' (rewritten)' : phase;
      logLink(link, phaseLabel);

      link.addEventListener(
        'load',
        () => {
          rewriteStylesheetHref(link);
          logLink(link, 'loaded');
        },
        { once: true }
      );

      link.addEventListener(
        'error',
        () => {
          rewriteStylesheetHref(link);
          logLink(link, 'error loading');
        },
        { once: true }
      );
    };

    const recordStyleElement = (style, phase) => {
      if (!style || loggedStyles.has(style)) return;
      loggedStyles.add(style);
      logStyle(style, phase);
    };

    // Observe new link/style nodes appended to the document
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;

          if (node.tagName === 'LINK' && (node.getAttribute('rel') || '').includes('stylesheet')) {
            attachLinkListeners(node, 'added');
          }

          if (node.tagName === 'STYLE') {
            recordStyleElement(node, 'added');
          }
        });
      });
    });

    try {
      const head = document.head || document.documentElement;
      if (head) {
        observer.observe(head, { childList: true, subtree: true });
      }
    } catch (e) {
      console.warn('⚠️ [Hatchway CSS] Failed to observe stylesheet mutations:', e);
    }

    // Log existing stylesheet/link elements when script runs
    document
      .querySelectorAll('link[rel~="stylesheet"], style')
      .forEach((node) => {
        if (node.tagName === 'LINK') {
          attachLinkListeners(node, 'existing');
        } else if (node.tagName === 'STYLE') {
          recordStyleElement(node, 'existing');
        }
      });

    // Capture late load events (when link is in DOM before listener added)
    document.addEventListener(
      'load',
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLLinkElement &&
          (target.getAttribute('rel') || '').includes('stylesheet')
        ) {
          attachLinkListeners(target, 'load event');
        }
      },
      true
    );
  }

  monitorStylesheets();

  // Create highlight overlay
  function createHighlightOverlay() {
    if (highlightOverlay) return highlightOverlay;

    const overlay = document.createElement('div');
    overlay.id = '__hatchway-highlight';
    overlay.style.cssText = \`
      position: absolute;
      pointer-events: none;
      border: 2px solid #7553FF;
      background: rgba(117, 83, 255, 0.1);
      z-index: 999999;
      transition: all 0.1s ease;
      box-shadow: 0 0 0 1px rgba(117, 83, 255, 0.3), 0 0 20px rgba(117, 83, 255, 0.4);
    \`;
    document.body.appendChild(overlay);
    highlightOverlay = overlay;
    return overlay;
  }

  // Remove highlight overlay
  function removeHighlightOverlay() {
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
  }

  // Highlight element on hover
  function highlightElement(element) {
    if (!element || !isInspectorActive) {
      removeHighlightOverlay();
      return;
    }

    const rect = element.getBoundingClientRect();
    const overlay = createHighlightOverlay();

    overlay.style.left = rect.left + window.scrollX + 'px';
    overlay.style.top = rect.top + window.scrollY + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    highlightedElement = element;
  }

  // Generate unique CSS selector for element
  function generateSelector(element) {
    // Strategy 1: data-testid (best)
    const testId = element.getAttribute('data-testid');
    if (testId) {
      return \`[data-testid="\${testId}"]\`;
    }

    // Strategy 2: ID (good)
    if (element.id) {
      return \`#\${element.id}\`;
    }

    // Strategy 3: Class + tag (ok) - but skip classes with colons (Tailwind responsive)
    const classes = Array.from(element.classList)
      .filter(c => !c.match(/^(hover:|focus:|active:|group-|animate-|transition-)/))
      .filter(c => !c.includes(':')) // Skip Tailwind responsive classes
      .slice(0, 3) // Limit to first 3 classes
      .join('.');

    if (classes) {
      const tagName = element.tagName.toLowerCase();

      try {
        // Check if unique enough
        const selector = \`\${tagName}.\${classes}\`;
        const matches = document.querySelectorAll(selector);

        if (matches.length === 1) {
          return selector;
        }

        // Add nth-child if multiple matches
        const parent = element.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const index = siblings.indexOf(element) + 1;
          return \`\${selector}:nth-child(\${index})\`;
        }

        return selector;
      } catch (err) {
        console.warn('Invalid selector, falling back to path:', err);
      }
    }

    // Strategy 4: Full path (fallback)
    return getFullPath(element);
  }

  // Get full CSS path to element
  function getFullPath(element) {
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += \`#\${current.id}\`;
        path.unshift(selector);
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          child => child.tagName === current.tagName
        );

        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += \`:nth-of-type(\${index})\`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // Capture element data and click position
  function captureElementData(element, clickEvent) {
    const rect = element.getBoundingClientRect();

    return {
      selector: generateSelector(element),
      tagName: element.tagName.toLowerCase(),
      className: element.className,
      id: element.id,
      textContent: element.textContent?.trim().slice(0, 100),
      innerHTML: element.innerHTML?.slice(0, 200),
      attributes: Array.from(element.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {}),
      boundingRect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      clickPosition: {
        x: clickEvent.clientX,
        y: clickEvent.clientY,
      },
      computedStyles: {
        backgroundColor: window.getComputedStyle(element).backgroundColor,
        color: window.getComputedStyle(element).color,
        fontSize: window.getComputedStyle(element).fontSize,
        fontFamily: window.getComputedStyle(element).fontFamily,
      }
    };
  }

  // Mouse move handler (hover preview)
  function handleMouseMove(e) {
    if (!isInspectorActive) return;

    const element = e.target;
    if (element && element !== highlightedElement) {
      highlightElement(element);
    }
  }

  // Click handler (select element)
  function handleClick(e) {
    console.log('🖱️ Click detected, selection mode:', isInspectorActive);

    if (!isInspectorActive) return;

    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const data = captureElementData(element, e);

    console.log('🎯 Element captured:', data);
    console.log('   Click position:', data.clickPosition);
    console.log('📤 Sending postMessage to parent...');

    // Send to parent window
    window.parent.postMessage({
      type: 'hatchway:element-selected',
      data,
    }, '*');

    console.log('✅ Message sent to parent');

    // Disable selection mode after selection
    setInspectorActive(false);
  }

  // Activate/deactivate inspector (DORMANT PATTERN)
  function setInspectorActive(active) {
    isInspectorActive = active;

    if (active) {
      // Add inspector styles ONLY when activated
      if (!inspectorStyle) {
        inspectorStyle = document.createElement('style');
        inspectorStyle.textContent = \`
          .inspector-active * {
            cursor: crosshair !important;
          }
          .inspector-highlight {
            outline: 2px solid #7553FF !important;
            outline-offset: -2px !important;
            background-color: rgba(117, 83, 255, 0.1) !important;
          }
        \`;
        document.head.appendChild(inspectorStyle);
      }

      document.body.classList.add('inspector-active');

      // Add event listeners ONLY when activated
      if (!mouseHandler) {
        mouseHandler = handleMouseMove;
        clickHandler = handleClick;
        document.addEventListener('mousemove', mouseHandler, true);
        document.addEventListener('click', clickHandler, true);
        console.log('✅ Inspector event listeners attached');
      }
    } else {
      document.body.classList.remove('inspector-active');

      // Remove highlight
      if (highlightedElement) {
        highlightedElement = null;
      }
      removeHighlightOverlay();

      // Remove event listeners when deactivated
      if (mouseHandler) {
        document.removeEventListener('mousemove', mouseHandler, true);
        document.removeEventListener('click', clickHandler, true);
        mouseHandler = null;
        clickHandler = null;
        console.log('🧹 Inspector event listeners removed');
      }

      // Remove styles
      if (inspectorStyle) {
        inspectorStyle.remove();
        inspectorStyle = null;
      }
    }

  }

  // Listen for activation/deactivation from parent
  window.addEventListener('message', (e) => {
    if (e.data.type === 'hatchway:toggle-selection-mode') {
      setInspectorActive(e.data.enabled);
    }
  });

  // Announce ready to parent
  window.parent.postMessage({ type: 'hatchway:ready' }, '*');
})();
`;

/**
 * Inject selection script into iframe
 * @param iframe - The iframe element to inject into
 * @param options - Optional configuration
 * @param options.enableHmrProxy - If true, also inject HMR proxy script for WebSocket tunneling
 */
export function injectSelectionScript(
  iframe: HTMLIFrameElement,
  options?: { enableHmrProxy?: boolean }
): boolean {
  try {
    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) {
      console.error('❌ Cannot access iframe window');
      return false;
    }

    const iframeDoc = iframeWindow.document;
    if (!iframeDoc) {
      console.error('❌ Cannot access iframe document');
      return false;
    }

    // Check if script already injected
    if (iframeDoc.getElementById('__hatchway-selection-script')) {
      console.log('⚠️  Selection script already injected');
      return true;
    }

    // Inject HMR proxy script FIRST (if enabled) - before any other scripts run
    // This ensures WebSocket is overridden before Vite's client script loads
    if (options?.enableHmrProxy) {
      if (!iframeDoc.getElementById('__hatchway-hmr-proxy-script')) {
        const hmrScript = iframeDoc.createElement('script');
        hmrScript.id = '__hatchway-hmr-proxy-script';
        hmrScript.textContent = HMR_PROXY_SCRIPT;
        // Inject at HEAD start to run before other scripts
        if (iframeDoc.head) {
          iframeDoc.head.insertBefore(hmrScript, iframeDoc.head.firstChild);
        } else if (iframeDoc.body) {
          iframeDoc.body.insertBefore(hmrScript, iframeDoc.body.firstChild);
        }
        console.log('✅ HMR proxy script injected into iframe');
      }
    }

    // Create and inject selection script element
    const script = iframeDoc.createElement('script');
    script.id = '__hatchway-selection-script';
    script.textContent = SELECTION_SCRIPT;
    iframeDoc.body.appendChild(script);

    console.log('✅ Selection script injected into iframe');
    return true;
  } catch (error) {
    console.error('❌ Failed to inject selection script:', error);
    return false;
  }
}

/**
 * Re-export HMR_PROXY_SCRIPT for direct use if needed
 */
export { HMR_PROXY_SCRIPT } from './hmr-proxy-script';

/**
 * Toggle selection mode in iframe
 */
export function toggleSelectionMode(iframe: HTMLIFrameElement, enabled: boolean): void {
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    console.error('❌ Cannot access iframe window');
    return;
  }

  iframeWindow.postMessage({
    type: 'hatchway:toggle-selection-mode',
    enabled,
  }, '*');
}
