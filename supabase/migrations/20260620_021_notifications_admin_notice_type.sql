-- 관리자 공지(admin_notice) 알림 타입 추가
-- notifications.type 의 CHECK 제약에 'admin_notice' 를 추가한다.
-- 관리자가 개별/전체 회원에게 보내는 공지를 기존 notifications 테이블로 전달하기 위함.
--
-- ⚠️ 수동 적용: Supabase SQL Editor 에서 직접 실행한다 (자동 적용 안 함).
-- 기존 행은 그대로 유효하다 (기존 타입은 모두 새 제약에도 포함됨).

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'usage_warning',
    'plan_expiry_7d',
    'plan_expiry_1d',
    'payment_success',
    'plan_upgraded',
    'admin_notice'
  ));
