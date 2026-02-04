// Browser detection hook for client-side metrics
'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export function useBrowserMetrics() {
  useEffect(() => {
    console.log('[Browser Metrics] Hook mounted - will send metrics in 1 second');
    
    // Only run once on mount
    const sendBrowserMetrics = () => {
      console.log('[Browser Metrics] Starting to collect browser metrics...');
      
      try {
        // User Agent
        const userAgent = navigator.userAgent;
        
        // Detect browser type and version
        const getBrowserInfo = () => {
          const uaLower = userAgent.toLowerCase();
          
          let browser = 'other';
          let version = 'unknown';
          
          if (uaLower.includes('edg/')) {
            browser = 'edge';
            const match = userAgent.match(/Edg\/(\d+)/);
            version = match ? match[1] : 'unknown';
          } else if (uaLower.includes('chrome/') && !uaLower.includes('edg/')) {
            browser = 'chrome';
            const match = userAgent.match(/Chrome\/(\d+)/);
            version = match ? match[1] : 'unknown';
          } else if (uaLower.includes('firefox/')) {
            browser = 'firefox';
            const match = userAgent.match(/Firefox\/(\d+)/);
            version = match ? match[1] : 'unknown';
          } else if (uaLower.includes('safari/') && !uaLower.includes('chrome/')) {
            browser = 'safari';
            const match = userAgent.match(/Version\/(\d+)/);
            version = match ? match[1] : 'unknown';
          } else if (uaLower.includes('opera/') || uaLower.includes('opr/')) {
            browser = 'opera';
            const match = userAgent.match(/(?:Opera|OPR)\/(\d+)/);
            version = match ? match[1] : 'unknown';
          }
          
          return { browser, version };
        };
        
        // Detect OS
        const getOS = () => {
          if (userAgent.includes('Win')) return 'windows';
          if (userAgent.includes('Mac')) return 'macos';
          if (userAgent.includes('Linux')) return 'linux';
          if (userAgent.includes('Android')) return 'android';
          if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'ios';
          return 'other';
        };
        
        // Detect device type
        const getDeviceType = () => {
          if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
            return 'tablet';
          }
          if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(userAgent)) {
            return 'mobile';
          }
          return 'desktop';
        };
        
        // Get connection info
        const getConnectionInfo = () => {
          // @ts-ignore - Connection API is experimental
          const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
          if (connection) {
            return {
              effectiveType: connection.effectiveType || 'unknown',
              downlink: connection.downlink?.toString() || 'unknown',
              rtt: connection.rtt?.toString() || 'unknown',
            };
          }
          return {
            effectiveType: 'unknown',
            downlink: 'unknown',
            rtt: 'unknown',
          };
        };
        
        // Get device memory (if available)
        const getDeviceMemory = () => {
          // @ts-ignore - deviceMemory is experimental
          return navigator.deviceMemory?.toString() || 'unknown';
        };
        
        // Get hardware concurrency (CPU cores)
        const getHardwareConcurrency = () => {
          return navigator.hardwareConcurrency?.toString() || 'unknown';
        };
        
        // Check touch support
        const getTouchSupport = () => {
          return ('ontouchstart' in window || navigator.maxTouchPoints > 0).toString();
        };
        
        const { browser, version } = getBrowserInfo();
        const os = getOS();
        const deviceType = getDeviceType();
        const connectionInfo = getConnectionInfo();
        
        // Comprehensive metrics
        const metrics = {
          // Browser info
          browser,
          browser_version: version,
          user_agent: userAgent.substring(0, 200), // Truncate to avoid huge strings
          
          // Device info
          os,
          device_type: deviceType,
          
          // Screen & Display
          screen_width: window.screen.width.toString(),
          screen_height: window.screen.height.toString(),
          screen_resolution: `${window.screen.width}x${window.screen.height}`,
          viewport_width: window.innerWidth.toString(),
          viewport_height: window.innerHeight.toString(),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          color_depth: window.screen.colorDepth.toString(),
          pixel_ratio: window.devicePixelRatio.toString(),
          
          // Capabilities
          touch_support: getTouchSupport(),
          cookies_enabled: navigator.cookieEnabled.toString(),
          online_status: navigator.onLine.toString(),
          hardware_concurrency: getHardwareConcurrency(),
          device_memory_gb: getDeviceMemory(),
          
          // Network
          connection_type: connectionInfo.effectiveType,
          connection_downlink: connectionInfo.downlink,
          connection_rtt: connectionInfo.rtt,
          
          // Locale & Language
          language: navigator.language || 'unknown',
          languages: navigator.languages?.join(',') || 'unknown',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
          
          // Referrer (where they came from)
          referrer: document.referrer || 'direct',
          
          // Do Not Track
          dnt: (navigator.doNotTrack || 'unknown').toString(),
        };
        
        // Send metric to Sentry
        console.log('[Browser Metrics] About to send metric to Sentry...');
        console.log('[Browser Metrics] Sentry.metrics available:', typeof Sentry.metrics !== 'undefined');
        console.log('[Browser Metrics] Metric attributes:', metrics);
        
        Sentry.metrics.count('page.loaded', 1, {
          attributes: metrics
        });
        
        console.log('[Browser Metrics] ✅ Metric sent successfully!');
        console.log('[Browser Metrics] Full metric data:', metrics);
      } catch (error) {
        console.error('[Browser Metrics] ❌ Failed to send metric:', error);
        console.error('[Browser Metrics] Error details:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    };
    
    console.log('[Browser Metrics] Setting 1-second timer...');
    // Send metrics after a short delay to ensure page is fully loaded
    const timer = setTimeout(() => {
      console.log('[Browser Metrics] Timer fired! Executing sendBrowserMetrics...');
      sendBrowserMetrics();
    }, 1000);
    
    return () => {
      console.log('[Browser Metrics] Cleaning up timer');
      clearTimeout(timer);
    };
  }, []); // Empty deps = run once on mount
}

