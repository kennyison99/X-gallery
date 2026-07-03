select 'BlueArchive+四季夏目' as query, i.id,
  substr(replace(replace(i.description, char(13), ' '), char(10), ' '), 1, 220) as description
from images i
join image_tags it1 on it1.image_id = i.id
join tags t1 on t1.id = it1.tag_id and t1.name = '蔚藍檔案'
join image_tags it2 on it2.image_id = i.id
join tags t2 on t2.id = it2.tag_id and t2.name = '四季夏目'
limit 8;

select 'BlueArchiveOnly_四季夏目Text' as query, i.id,
  substr(replace(replace(i.description, char(13), ' '), char(10), ' '), 1, 220) as description
from images i
join image_tags it1 on it1.image_id = i.id
join tags t1 on t1.id = it1.tag_id and t1.name = '蔚藍檔案'
where i.description like '%四季夏目%'
limit 8;

select 'Arknights+Endfield' as query, i.id,
  substr(replace(replace(i.description, char(13), ' '), char(10), ' '), 1, 220) as description
from images i
join image_tags it1 on it1.image_id = i.id
join tags t1 on t1.id = it1.tag_id and t1.name = '明日方舟'
join image_tags it2 on it2.image_id = i.id
join tags t2 on t2.id = it2.tag_id and t2.name = '明日方舟：終末地'
limit 8;
