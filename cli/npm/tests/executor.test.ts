import { PrompdExecutor } from '../src/lib/executor';
import { ConfigManager } from '../src/lib/config';
import { PrompdParser } from '../src/lib/parser';
import * as https from 'https';
import { IncomingMessage } from 'http';

// Mock https module
jest.mock('https');
const mockHttps = https as jest.Mocked<typeof https>;

// Mock ConfigManager and PrompdParser
jest.mock('../src/lib/config');
jest.mock('../src/lib/parser');

describe('PrompdExecutor', () => {
  let executor: PrompdExecutor;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockParser: jest.Mocked<PrompdParser>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfigManager = {
      loadConfig: jest.fn(),
      getApiKey: jest.fn(),
      isProviderConfigured: jest.fn(),
    } as any;
    
    mockParser = {
      parseFile: jest.fn(),
    } as any;
    
    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfigManager);
    
    executor = new PrompdExecutor();
  });

  describe('execute', () => {
    const mockPrompdFile = {
      metadata: {
        name: 'test-prompt',
        parameters: [
          { name: 'topic', type: 'string' as const, required: true }
        ],
        variables: []
      },
      content: 'Discuss the topic: {topic}',
      sections: {}
    };

    it('should execute with OpenAI provider', async () => {
      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {}
      };
      
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');
      mockParser.parseFile.mockResolvedValue(mockPrompdFile);
      (executor as any).parser = mockParser;
      
      // Mock successful API response
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({
              choices: [{ message: { content: 'Test response from OpenAI' } }]
            }));
          }
          if (event === 'end') {
            callback();
          }
        })
      } as unknown as IncomingMessage;
      
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn()
      };
      
      mockHttps.request.mockImplementation((options: any, callback?: any) => {
        if (callback) callback(mockResponse as IncomingMessage);
        return mockRequest as any;
      });
      
      const result = await executor.execute('test.prmd', { 
        provider: 'openai',
        model: 'gpt-4',
        params: { topic: 'AI' }
      });
      
      expect(result.success).toBe(true);
      expect(result.response).toBe('Test response from OpenAI');
      expect(mockHttps.request).toHaveBeenCalled();
    });

    it('should substitute parameters correctly', async () => {
      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {}
      };
      
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');
      mockParser.parseFile.mockResolvedValue(mockPrompdFile);
      (executor as any).parser = mockParser;
      
      const substituted = (executor as any).processTemplate(
        mockPrompdFile.content,
        { topic: 'Machine Learning' }
      );
      
      expect(substituted).toBe('Discuss the topic: Machine Learning');
    });

    it('should validate required parameters', async () => {
      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {}
      };
      
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockParser.parseFile.mockResolvedValue(mockPrompdFile);
      (executor as any).parser = mockParser;
      
      await expect(executor.execute('test.prmd', { 
        provider: 'openai',
        model: 'gpt-4',
        params: {}
      })).rejects.toThrow('Required parameter missing: topic');
    });

    it('should handle API errors gracefully', async () => {
      const mockConfig = {
        defaultProvider: 'openai',
        defaultModel: 'gpt-4',
        apiKeys: { openai: 'test-key' },
        customProviders: {}
      };
      
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');
      mockParser.parseFile.mockResolvedValue(mockPrompdFile);
      (executor as any).parser = mockParser;
      
      // Mock error response
      const mockResponse = {
        statusCode: 401,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({ error: { message: 'Unauthorized' } }));
          }
          if (event === 'end') {
            callback();
          }
        })
      } as unknown as IncomingMessage;
      
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn()
      };
      
      mockHttps.request.mockImplementation((options: any, callback?: any) => {
        if (callback) callback(mockResponse as IncomingMessage);
        return mockRequest as any;
      });
      
      const result = await executor.execute('test.prmd', { 
        provider: 'openai',
        model: 'gpt-4',
        params: { topic: 'AI' }
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 401');
    });

    it('should work with Anthropic provider', async () => {
      const mockConfig = {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-3-sonnet-20240229',
        apiKeys: { anthropic: 'test-key' },
        customProviders: {}
      };
      
      mockConfigManager.loadConfig.mockResolvedValue(mockConfig);
      mockConfigManager.getApiKey.mockReturnValue('test-key');
      mockParser.parseFile.mockResolvedValue(mockPrompdFile);
      (executor as any).parser = mockParser;
      
      // Mock successful API response
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify({
              content: [{ text: 'Test response from Anthropic' }]
            }));
          }
          if (event === 'end') {
            callback();
          }
        })
      } as unknown as IncomingMessage;
      
      const mockRequest = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn()
      };
      
      mockHttps.request.mockImplementation((options: any, callback?: any) => {
        if (callback) callback(mockResponse as IncomingMessage);
        return mockRequest as any;
      });
      
      const result = await executor.execute('test.prmd', { 
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        params: { topic: 'AI' }
      });
      
      expect(result.success).toBe(true);
      expect(result.response).toBe('Test response from Anthropic');
    });
  });
});