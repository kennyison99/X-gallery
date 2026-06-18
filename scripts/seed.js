import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const IMAGES_DIR = 'C:\\Users\\wtw0212\\Pictures\\Twitter_backup\\foglantau\\images';
const BUCKET_NAME = 'gallery-images';
const DB_NAME = 'gallery-db';

async function seed() {
  console.log(`Reading images from: ${IMAGES_DIR}`);
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('Images directory does not exist.');
    return;
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
  });

  console.log(`Found ${files.length} raw image files.`);

  // Group images by post prefix
  // Filename format: author_date_time_tweetId_index.ext
  // e.g. foglantau_20260403_040647_2039917506295648359_01.jpg
  const groupMap = {};
  files.forEach(file => {
    const lastUnderscore = file.lastIndexOf('_');
    if (lastUnderscore === -1) {
      groupMap[file] = [file];
    } else {
      const prefix = file.substring(0, lastUnderscore);
      if (!groupMap[prefix]) {
        groupMap[prefix] = [];
      }
      groupMap[prefix].push(file);
    }
  });

  const posts = Object.keys(groupMap).map(prefix => {
    // Sort files in the group so _01 is first, then _02...
    const groupFiles = groupMap[prefix].sort((a, b) => a.localeCompare(b));
    return {
      prefix,
      files: groupFiles
    };
  });

  console.log(`Grouped into ${posts.length} posts/cards.`);

  // Insert default tags
  const defaultTags = ['foglantau', '白絲', '黑絲', '日常', 'COS'];
  for (const tag of defaultTags) {
    try {
      execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="INSERT OR IGNORE INTO tags (name) VALUES ('${tag}')"`, { stdio: 'ignore' });
    } catch (err) {
      console.error(`Failed to insert tag ${tag}:`, err);
    }
  }

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const firstFile = post.files[0];
    
    // Parse parts
    const parts = firstFile.split('_');
    const author = parts[0] || 'foglantau';
    const dateStr = parts[1] ? `${parts[1].substring(0,4)}-${parts[1].substring(4,6)}-${parts[1].substring(6,8)}` : '2026-04-03';
    const tweetId = parts[3];
    
    const title = `推文寫真集 #${i + 1}`;
    const authorUrl = `https://x.com/${author}`;
    const postUrl = tweetId ? `https://x.com/${author}/status/${tweetId}` : `https://x.com/${author}`;
    
    const description = `分享 ${post.files.length} 張精美寫真，發佈於 ${dateStr}。極簡的光影與美感細節。`;
    
    // Upload files in the post to R2
    const r2Keys = [];
    for (const file of post.files) {
      const filePath = path.join(IMAGES_DIR, file);
      const r2Key = file;
      r2Keys.push(r2Key);
      
      console.log(`Uploading ${file} to local R2...`);
      try {
        execSync(`npx wrangler r2 object put ${BUCKET_NAME}/${r2Key} --file="${filePath}" --local`, { stdio: 'ignore' });
      } catch (err) {
        console.error(`Failed to upload ${file} to R2:`, err);
      }
    }

    const r2KeysString = r2Keys.join(',');
    
    // Insert post into D1
    console.log(`Inserting D1 entry for post: ${title} (${post.files.length} images)`);
    try {
      const escapedTitle = title.replace(/'/g, "''");
      const escapedDesc = description.replace(/'/g, "''");
      const escapedKeys = r2KeysString.replace(/'/g, "''");
      const escapedAuthor = author.replace(/'/g, "''");
      const escapedAuthorUrl = authorUrl.replace(/'/g, "''");
      const escapedPostUrl = postUrl.replace(/'/g, "''");
      
      const insertQuery = `INSERT INTO images (title, r2_keys, author, author_url, post_url, description) VALUES ('${escapedTitle}', '${escapedKeys}', '${escapedAuthor}', '${escapedAuthorUrl}', '${escapedPostUrl}', '${escapedDesc}')`;
      
      execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="${insertQuery}"`, { stdio: 'ignore' });
      
      // Get the inserted ID
      const queryResult = execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="SELECT id FROM images WHERE r2_keys = '${escapedKeys}'" --json`).toString();
      const rows = JSON.parse(queryResult)[0].results;
      if (rows && rows.length > 0) {
        const imageId = rows[0].id;
        
        // Link tags:
        // Every image gets tag 'foglantau'
        execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="INSERT OR IGNORE INTO image_tags (image_id, tag_id) SELECT ${imageId}, id FROM tags WHERE name = 'foglantau'"`, { stdio: 'ignore' });
        
        // Odd index gets '白絲', even gets '黑絲'
        const tag2 = i % 2 === 0 ? '白絲' : '黑絲';
        execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="INSERT OR IGNORE INTO image_tags (image_id, tag_id) SELECT ${imageId}, id FROM tags WHERE name = '${tag2}'"`, { stdio: 'ignore' });
        
        // Multiple of 3 gets '日常', others get 'COS'
        const tag3 = i % 3 === 0 ? '日常' : 'COS';
        execSync(`npx wrangler d1 execute ${DB_NAME} --local --command="INSERT OR IGNORE INTO image_tags (image_id, tag_id) SELECT ${imageId}, id FROM tags WHERE name = '${tag3}'"`, { stdio: 'ignore' });
      }
    } catch (err) {
      console.error(`Failed to insert image entry to D1:`, err);
    }
  }

  console.log('Seeding completed successfully!');
}

seed();
