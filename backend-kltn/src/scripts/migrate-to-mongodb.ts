/**
 * Migration script: đọc file cũ và import vào MongoDB.
 * Chạy: npx ts-node src/scripts/migrate-to-mongodb.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const CSV2GRAPH_DIR = path.join(DATA_DIR, 'csv2graph');
const SCHEMAS_DIR = path.join(DATA_DIR, 'schemas');

async function migrate() {
  console.log('🔌 Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI!, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db = client.db('fraud_detection');
  const database = 'neo4j';

  // ── 1. Migrate _latest_neo4j.json ──
  const latestPath = path.join(CSV2GRAPH_DIR, `_latest_${database}.json`);
  if (fs.existsSync(latestPath)) {
    console.log('\n📦 Migrating _latest_neo4j.json...');
    const meta = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));

    await db.collection('datasets').updateOne(
      { database },
      {
        $set: {
          database,
          nodeLabel: meta.nodeLabel,
          targetLabel: meta.targetLabel,
          columns: meta.columns,
          hasModel: meta.hasModel ?? false,
          activeModelPath: meta.activeModelPath,
          trainingMetrics: meta.trainingMetrics,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    console.log('  ✅ datasets: upserted');

    const schema = meta.schema;
    if (schema) {
      await db.collection('pipeline_configs').updateOne(
        { database },
        {
          $set: {
            database,
            relationCols: schema.relation_cols ?? [],
            featureCols: schema.feature_cols ?? [],
            encodedFeatureCols: schema.encoded_feature_cols ?? [],
            trainRatio: schema.train_ratio ?? 0.4,
            valRatio: schema.val_ratio ?? 0.2,
            seed: schema.seed ?? 42,
            maxGroupSize: schema.max_group_size ?? 500,
          },
        },
        { upsert: true },
      );
      console.log('  ✅ pipeline_configs: upserted');

      if (schema.encoding_maps && Object.keys(schema.encoding_maps).length > 0) {
        await db.collection('encoding_maps').updateOne(
          { database },
          { $set: { database, maps: schema.encoding_maps } },
          { upsert: true },
        );
        const size = (JSON.stringify(schema.encoding_maps).length / 1024 / 1024).toFixed(1);
        console.log(`  ✅ encoding_maps: upserted (${size}MB)`);
      }
    }
  } else {
    console.log('⚠️  _latest_neo4j.json not found, skipping');
  }

  // ── 2. Migrate _raw_neo4j.json ──
  const rawPath = path.join(CSV2GRAPH_DIR, `_raw_${database}.json`);
  if (fs.existsSync(rawPath)) {
    console.log('\n📦 Migrating _raw_neo4j.json...');
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
    await db.collection('pipeline_configs').updateOne(
      { database },
      { $set: { originalIdCol: raw.originalIdCol, rawColumns: raw.rawColumns } },
      { upsert: true },
    );
    console.log('  ✅ pipeline_configs: rawColumns updated');
  }

  // ── 3. Migrate schema_neo4j.txt ──
  const schemaPath = path.join(SCHEMAS_DIR, `schema_${database}.txt`);
  if (fs.existsSync(schemaPath)) {
    console.log('\n📦 Migrating schema_neo4j.txt...');
    const schemaText = fs.readFileSync(schemaPath, 'utf-8');
    await db.collection('datasets').updateOne(
      { database },
      { $set: { graphSchema: schemaText } },
      { upsert: true },
    );
    console.log('  ✅ datasets.graphSchema: updated');
  }

  console.log('\n🎉 Migration complete!');
  await client.close();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
