select '橘光' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%橘光%' limit 5;

select 'Cipher' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%cipher%' or description like '%Cipher%' limit 5;

select 'Castoric' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%Castoric%' or description like '%キャストリス%' limit 5;

select 'GenshinCandidates' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%胡桃%' or description like '%Eula%' or description like '%フィッシュル%' limit 10;

select '帕萨迪纳' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%帕萨迪纳%' limit 5;

select 'FateCandidates' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%斯卡哈%' or description like '%shutendoji%' limit 10;

select 'staygold' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%staygold%' or description like '%StayGold%' limit 5;

select 'Mast' as query, id, substr(replace(replace(description, char(13), ' '), char(10), ' '), 1, 220) as description
from images where description like '%Mast%' limit 5;
