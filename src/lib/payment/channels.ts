export type PaymentMethodType = 'CARD'

export interface PaymentMethodConfig {
  type: PaymentMethodType
  label: string
  channelKeyEnv: string
  payMethod: string
  icon: string
}

export const PAYMENT_METHODS: PaymentMethodConfig[] = [
  {
    type: 'CARD',
    label: '신용/체크카드',
    channelKeyEnv: 'NEXT_PUBLIC_PORTONE_CHANNEL_KEY_KPN_BILLING',
    payMethod: 'CARD',
    icon: '💳',
  },
]

export function getChannelKey(type: PaymentMethodType = 'CARD'): string {
  const method = PAYMENT_METHODS.find((m) => m.type === type)
  if (!method) throw new Error(`알 수 없는 결제 수단: ${type}`)

  const key = process.env[method.channelKeyEnv]
  if (!key) throw new Error(`${method.channelKeyEnv} 환경변수가 설정되지 않았습니다`)
  return key
}

export function getPaymentMethodConfig(type: PaymentMethodType = 'CARD'): PaymentMethodConfig {
  const method = PAYMENT_METHODS.find((m) => m.type === type)
  if (!method) throw new Error(`알 수 없는 결제 수단: ${type}`)
  return method
}
