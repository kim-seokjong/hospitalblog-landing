'use client';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h2 className="text-xl font-bold mb-2">대시보드 로드 실패</h2>
      <pre className="text-sm text-rose-400 mb-4 whitespace-pre-wrap">
        {error.message}
      </pre>
      <button
        onClick={reset}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm text-white"
      >
        다시 시도
      </button>
    </div>
  );
}
