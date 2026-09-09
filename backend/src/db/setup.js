const { Client } = require("pg");
require("dotenv").config({ path: "../../.env" });
const env = require("../config/env");

async function setupDatabase() {
  // Parse connection string to get credentials for the 'postgres' default database
  const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/converter";
  const url = new URL(connectionString);
  const dbName = url.pathname.split("/")[1];
  
  // Connect to 'postgres' database first to create the target database
  const client = new Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: url.port,
    database: "postgres",
  });

  try {
    await client.connect();
    
    // Check if database exists
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    
    if (res.rowCount === 0) {
      console.log(`Database '${dbName}' does not exist. Creating...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database '${dbName}' created successfully.`);
    } else {
      console.log(`Database '${dbName}' already exists.`);
    }
  } catch (error) {
    console.error("Error setting up database:", error);
  } finally {
    await client.end();
  }
}

setupDatabase();
