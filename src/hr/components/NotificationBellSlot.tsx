'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import NotificationBell from './NotificationBell';

/**
 * 알림 벨 자리 — 로그인 여부를 **클라이언트에서** 판정해 벨을 띄운다.
 *
 * ★ 왜 서버가 아니라 여기서 판정하는가:
 *   루트 레이아웃에서 로그인 조회(cookies())를 하면 하위 세그먼트 전체가 동적으로
 *   내려가 /clinic-site/* 의 ISR(revalidate=3600)이 죽는다. 벨은 로그인 회원에게만
 *   보이는 부가 UI 라 서버 렌더가 필요 없다 — 판정을 브라우저로 내린다.
 *
 * 위치를 잡는 fixed 래퍼까지 이 안에 둔다 — 로그아웃 상태에서 빈 박스가 남지 않도록.
 * onAuthStateChange 를 구독해 로그인·로그아웃 전환도 새로고침 없이 따라간다.
 */
export default function NotificationBellSlot() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let active = true;
    // 구독 이벤트가 한 번이라도 오면 그쪽이 최신이다 — 뒤늦게 도착한 getUser 응답이
    // 로그인/로그아웃 전환을 되돌리지 않도록 막는다.
    let eventSeen = false;
    let unsubscribe: (() => void) | null = null;

    try {
      const supabase = createClient();

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        eventSeen = true;
        if (active) setIsLoggedIn(Boolean(session?.user));
      });
      unsubscribe = () => data.subscription.unsubscribe();

      // 저장된 세션이 실제로 유효한지 서버에 확인 (만료 토큰으로 벨이 뜨지 않도록).
      void supabase.auth
        .getUser()
        .then(({ data: { user } }) => {
          if (active && !eventSeen) setIsLoggedIn(Boolean(user));
        })
        .catch(() => {
          // 네트워크 오류 시 벨을 띄우지 않는다 (기본값 false 유지).
        });
    } catch {
      // Supabase 환경변수 미설정 — 벨 없이 나머지 화면은 그대로 동작한다.
    }

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  if (!isLoggedIn) return null;

  return (
    <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-40">
      <NotificationBell />
    </div>
  );
}
