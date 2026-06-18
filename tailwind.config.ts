import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    // src 전체를 스캔한다. 팀 폴더(hr/content/payment/dev/publish)로
    // 재배치(ac4329c)된 뒤 일부 경로만 지정돼 해당 폴더 전용 클래스가
    // CSS로 생성되지 않던 버그를 방지하기 위해 src/** 전체로 통일.
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        medical: {
          green: '#10b981',
          blue: '#0ea5e9',
        },
        // 닥터포스트 랜딩 라이트 테마 brand 팔레트 (dp-light-mockup 기준)
        brand: {
          red: '#ff4628',
          'red-d': '#e63a1c',
          'red-soft': '#ffece7',
          ink: '#202020',
          steel: '#b8c8d7',
          'steel-soft': '#eef2f6',
          line: '#dbe2ea',
          body: '#4a4f55',
          muted: '#8a93a0',
        },
      },
    },
  },
  plugins: [],
};

export default config;
