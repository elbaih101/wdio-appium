import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple JSON utility for test data management
 */
export class TestData {
  private filePath: string;
  private data: any;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.data = this.load();
  }

  /**
   * Load JSON data from file
   */
  private load(): any {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const content = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load test data: ${errorMessage}`);
      return {};
    }
  }

  /**
   * Save current data to file
   */
  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save test data: ${errorMessage}`);
    }
  }

  /**
   * Get a value by key
   * @param key - The key to retrieve (supports dot notation like 'user.name')
   * @param defaultValue - Default value if key doesn't exist
   */
  get(key: string, defaultValue?: any): any {
    const keys = key.split('.');
    let value = this.data;
    
    for (const k of keys) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[k];
    }
    
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Set a value by key
   * @param key - The key to set (supports dot notation like 'user.name')
   * @param value - The value to set
   */
  set(key: string, value: any): void {
    const keys = key.split('.');
    let current = this.data;
    
    // Create nested objects if they don't exist
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    // Set the value
    current[keys[keys.length - 1]] = value;
    
    // Save to file
    this.save();
  }

  /**
   * Get all data
   */
  getAll(): any {
    return this.data;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data = {};
    this.save();
  }

  /**
   * Delete a key
   * @param key - The key to delete (supports dot notation)
   */
  delete(key: string): boolean {
    const keys = key.split('.');
    let current = this.data;
    
    // Navigate to parent
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        return false;
      }
      current = current[k];
    }
    
    // Delete the key
    const lastKey = keys[keys.length - 1];
    if (lastKey in current) {
      delete current[lastKey];
      this.save();
      return true;
    }
    
    return false;
  }

  /**
   * Check if a key exists
   * @param key - The key to check (supports dot notation)
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

/**
 * Create a test data instance with a specific file
 * @param filename - The filename (will be stored in test-data directory)
 */
export function createTestData(filename: string): TestData {
  const testDataDir = path.join(process.cwd(), 'test/testdata');
  
  // Create test-data directory if it doesn't exist
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  
  const filePath = path.join(testDataDir, filename);
  return new TestData(filePath);
}