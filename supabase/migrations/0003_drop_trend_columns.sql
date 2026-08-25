-- 외부 트렌드 API(네이버 데이터랩) 연동을 범위에서 뺐다.
--
-- 데이터랩에는 '실시간 급상승 검색어' API 가 없고(서비스 자체가 2021년 종료),
-- 내가 준 키워드의 검색 비율만 알려주는 구조라 어차피 후보 키워드는
-- 우리가 갖고 있어야 했다. 그래서 큐레이션 시드 풀만 쓰기로 했다.

alter table public.seed_keywords drop column if exists trend_ratio;
alter table public.seed_keywords drop column if exists trend_checked_at;

-- 시드는 이제 전부 큐레이션 풀이다. 'trend' 출처는 쓰지 않는다.
update public.seed_keywords set source = 'default' where source <> 'default';
