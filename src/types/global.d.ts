interface Window {
  fbq: (
    command: 'track' | 'trackCustom' | 'init' | 'pageView',
    eventNameOrPixelId: string,
    params?: Record<string, any>
  ) => void;
  PortOne?: {
    requestPayment: (params: unknown) => Promise<{
      code?: string
      message?: string
      paymentId?: string
    }>
    requestBillingKeyAndPay: (params: unknown) => Promise<{
      billingKey?: string
      paymentId?: string
      code?: string
      message?: string
    }>
  }
}
