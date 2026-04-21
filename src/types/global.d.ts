interface Window {
  fbq: (
    command: 'track' | 'trackCustom' | 'init' | 'pageView',
    eventNameOrPixelId: string,
    params?: Record<string, any>
  ) => void;
}
