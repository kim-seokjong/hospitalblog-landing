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
      },
    },
  },
  plugins: [],
};

export default config;
