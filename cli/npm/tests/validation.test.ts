import {
  validatePackageName,
  validateVersion,
  validateNamespace,
  validateRegistryUrl,
  sanitizeFilePath,
  validateFileExtension,
  validateParameterKey,
  sanitizeParameterKey,
  detectSecrets,
  validateGitRef,
  validateModelName,
  validateProviderName,
  validateEmail,
  containsMaliciousContent,
  validateNumericRange,
  validateStringLength,
  ValidationError,
  SecurityError
} from '../src/lib/validation';

describe('Validation Module', () => {

  describe('validatePackageName', () => {
    it('should validate correct package names', () => {
      expect(validatePackageName('my-package')).toBe(true);
      expect(validatePackageName('package-name')).toBe(true);
      expect(validatePackageName('package.name')).toBe(true);
      expect(validatePackageName('@scope/package')).toBe(true);
      expect(validatePackageName('@my-org/my-package')).toBe(true);
    });

    it('should reject invalid package names', () => {
      expect(validatePackageName('My-Package')).toBe(false); // uppercase
      expect(validatePackageName('package name')).toBe(false); // space
      expect(validatePackageName('.package')).toBe(false); // starts with dot
      expect(validatePackageName('_package')).toBe(false); // starts with underscore
      expect(validatePackageName('')).toBe(false); // empty
      expect(validatePackageName('a'.repeat(215))).toBe(false); // too long
    });
  });

  describe('validateVersion', () => {
    it('should validate correct semantic versions', () => {
      expect(validateVersion('1.0.0')).toBe(true);
      expect(validateVersion('0.0.1')).toBe(true);
      expect(validateVersion('2.1.3')).toBe(true);
      expect(validateVersion('1.0.0-alpha')).toBe(true);
      expect(validateVersion('1.0.0-beta.1')).toBe(true);
      expect(validateVersion('1.0.0+build.123')).toBe(true);
      expect(validateVersion('1.0.0-rc.1+build.456')).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(validateVersion('1.0')).toBe(false); // missing patch
      expect(validateVersion('1')).toBe(false); // missing minor and patch
      expect(validateVersion('v1.0.0')).toBe(false); // has 'v' prefix
      expect(validateVersion('1.0.0.')).toBe(false); // trailing dot
      expect(validateVersion('')).toBe(false); // empty
      expect(validateVersion('latest')).toBe(false); // not semver
    });
  });

  describe('validateNamespace', () => {
    it('should validate correct namespaces', () => {
      expect(validateNamespace('@myorg')).toBe(true);
      expect(validateNamespace('@my-org')).toBe(true);
      expect(validateNamespace('@my.org')).toBe(true);
    });

    it('should reject invalid namespaces', () => {
      expect(validateNamespace('myorg')).toBe(false); // missing @
      expect(validateNamespace('@My-Org')).toBe(false); // uppercase
      expect(validateNamespace('@my org')).toBe(false); // space
      expect(validateNamespace('')).toBe(false); // empty
    });
  });

  describe('validateRegistryUrl', () => {
    it('should validate HTTPS URLs', () => {
      expect(validateRegistryUrl('https://registry.prompdhub.ai')).toBe(true);
      expect(validateRegistryUrl('https://example.com')).toBe(true);
      expect(validateRegistryUrl('https://registry.example.com:8080')).toBe(true);
    });

    it('should allow HTTP only for localhost', () => {
      expect(validateRegistryUrl('http://localhost:4000')).toBe(true);
      expect(validateRegistryUrl('http://127.0.0.1:4000')).toBe(true);
    });

    it('should reject HTTP for non-localhost', () => {
      expect(validateRegistryUrl('http://example.com')).toBe(false);
      expect(validateRegistryUrl('http://registry.prompdhub.ai')).toBe(false);
    });

    it('should reject invalid protocols', () => {
      expect(validateRegistryUrl('ftp://example.com')).toBe(false);
      expect(validateRegistryUrl('file:///path/to/file')).toBe(false);
      expect(validateRegistryUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(validateRegistryUrl('not-a-url')).toBe(false);
      expect(validateRegistryUrl('')).toBe(false);
    });
  });

  describe('sanitizeFilePath', () => {
    it('should allow safe relative paths', () => {
      expect(sanitizeFilePath('file.txt')).toBe('file.txt');
      expect(sanitizeFilePath('subdir/file.txt')).toBe('subdir/file.txt');
    });

    it('should throw on directory traversal attempts', () => {
      expect(() => sanitizeFilePath('../file.txt')).toThrow(SecurityError);
      expect(() => sanitizeFilePath('../../etc/passwd')).toThrow(SecurityError);
      expect(() => sanitizeFilePath('subdir/../../../file.txt')).toThrow(SecurityError);
    });

    it('should enforce base path boundaries', () => {
      const basePath = '/safe/directory';
      expect(sanitizeFilePath('file.txt', basePath)).toContain('safe/directory');
      expect(() => sanitizeFilePath('../../../etc/passwd', basePath)).toThrow(SecurityError);
    });
  });

  describe('validateFileExtension', () => {
    it('should validate allowed extensions', () => {
      expect(validateFileExtension('file.txt', ['.txt'])).toBe(true);
      expect(validateFileExtension('file.prmd', ['.prmd', '.txt'])).toBe(true);
      expect(validateFileExtension('file.JSON', ['.json'])).toBe(true); // case insensitive
    });

    it('should reject disallowed extensions', () => {
      expect(validateFileExtension('file.exe', ['.txt'])).toBe(false);
      expect(validateFileExtension('file', ['.txt'])).toBe(false); // no extension
    });
  });

  describe('validateParameterKey', () => {
    it('should validate correct parameter keys', () => {
      expect(validateParameterKey('param')).toBe(true);
      expect(validateParameterKey('param_name')).toBe(true);
      expect(validateParameterKey('paramName')).toBe(true);
      expect(validateParameterKey('_private')).toBe(true);
    });

    it('should reject invalid parameter keys', () => {
      expect(validateParameterKey('123param')).toBe(false); // starts with number
      expect(validateParameterKey('param-name')).toBe(false); // hyphen
      expect(validateParameterKey('param name')).toBe(false); // space
      expect(validateParameterKey('a'.repeat(129))).toBe(false); // too long
      expect(validateParameterKey('')).toBe(false); // empty
    });
  });

  describe('sanitizeParameterKey', () => {
    it('should sanitize parameter keys', () => {
      expect(sanitizeParameterKey('param-name')).toBe('param_name');
      expect(sanitizeParameterKey('param name')).toBe('param_name');
      expect(sanitizeParameterKey('param.name')).toBe('param_name');
    });

    it('should throw on invalid keys', () => {
      expect(() => sanitizeParameterKey('')).toThrow(ValidationError);
      expect(() => sanitizeParameterKey('a'.repeat(200))).toThrow(ValidationError);
    });
  });

  describe('detectSecrets', () => {
    it('should detect OpenAI API keys', () => {
      const content = 'API_KEY=sk-proj1234567890abcdefghijklmnopqr';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('OpenAI API Key');
    });

    it('should detect Anthropic API keys', () => {
      const content = 'ANTHROPIC_KEY=sk-ant-api03-1234567890abcdefghijklmnopqrstuv';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('Anthropic API Key');
    });

    it('should detect Prompd registry tokens', () => {
      const content = 'TOKEN=prompd_1234567890abcdefghijklmnopqrstuv';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('Prompd Registry Token');
    });

    it('should detect AWS access keys', () => {
      const content = 'AWS_KEY=AKIAIOSFODNN7EXAMPLE';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('AWS Access Key');
    });

    it('should detect private key headers', () => {
      const content = '-----BEGIN PRIVATE KEY-----';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('Private Key Header');
    });

    it('should detect GitHub tokens', () => {
      const content = 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe('GitHub Token');
    });

    it('should return empty array for clean content', () => {
      const content = 'This is just normal text without any secrets.';
      const secrets = detectSecrets(content);
      expect(secrets).toHaveLength(0);
    });

    it('should mask secrets in results', () => {
      const content = 'API_KEY=sk-1234567890abcdefghijklmnopqrstuv';
      const secrets = detectSecrets(content);
      expect(secrets[0].match).not.toContain('1234567890abcdefghijklmnopqrstuv');
      expect(secrets[0].match).toContain('...');
    });
  });

  describe('validateGitRef', () => {
    it('should validate git references', () => {
      expect(validateGitRef('main')).toBe(true);
      expect(validateGitRef('feature/new-feature')).toBe(true);
      expect(validateGitRef('v1.0.0')).toBe(true);
      expect(validateGitRef('abc123def')).toBe(true); // commit hash
    });

    it('should reject invalid git references', () => {
      expect(validateGitRef('feature name')).toBe(false); // space
      expect(validateGitRef('')).toBe(false); // empty
    });
  });

  describe('validateModelName', () => {
    it('should validate model names', () => {
      expect(validateModelName('gpt-4')).toBe(true);
      expect(validateModelName('claude-3-opus-20240229')).toBe(true);
      expect(validateModelName('llama3.2')).toBe(true);
      expect(validateModelName('mixtral-8x7b')).toBe(true);
    });

    it('should reject invalid model names', () => {
      expect(validateModelName('gpt 4')).toBe(false); // space
      expect(validateModelName('')).toBe(false); // empty
    });
  });

  describe('validateProviderName', () => {
    it('should validate provider names', () => {
      expect(validateProviderName('openai')).toBe(true);
      expect(validateProviderName('anthropic')).toBe(true);
      expect(validateProviderName('local-ollama')).toBe(true);
    });

    it('should reject invalid provider names', () => {
      expect(validateProviderName('OpenAI')).toBe(false); // uppercase
      expect(validateProviderName('open ai')).toBe(false); // space
      expect(validateProviderName('123provider')).toBe(false); // starts with number
      expect(validateProviderName('')).toBe(false); // empty
    });
  });

  describe('validateEmail', () => {
    it('should validate correct emails', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('first.last@example.co.uk')).toBe(true);
      expect(validateEmail('user+tag@example.com')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('notanemail')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });
  });

  describe('containsMaliciousContent', () => {
    it('should detect script tags', () => {
      expect(containsMaliciousContent('<script>alert(1)</script>')).toBe(true);
      expect(containsMaliciousContent('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    });

    it('should detect javascript protocol', () => {
      expect(containsMaliciousContent('javascript:alert(1)')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(containsMaliciousContent('onclick=alert(1)')).toBe(true);
      expect(containsMaliciousContent('onerror=alert(1)')).toBe(true);
    });

    it('should detect eval calls', () => {
      expect(containsMaliciousContent('eval("malicious")')).toBe(true);
    });

    it('should allow clean content', () => {
      expect(containsMaliciousContent('This is clean text')).toBe(false);
    });
  });

  describe('validateNumericRange', () => {
    it('should validate numbers within range', () => {
      expect(validateNumericRange(5, 0, 10)).toBe(true);
      expect(validateNumericRange(0, 0, 10)).toBe(true);
      expect(validateNumericRange(10, 0, 10)).toBe(true);
    });

    it('should reject numbers outside range', () => {
      expect(validateNumericRange(-1, 0, 10)).toBe(false);
      expect(validateNumericRange(11, 0, 10)).toBe(false);
    });

    it('should reject non-finite numbers', () => {
      expect(validateNumericRange(Infinity, 0, 10)).toBe(false);
      expect(validateNumericRange(NaN, 0, 10)).toBe(false);
    });
  });

  describe('validateStringLength', () => {
    it('should validate strings within length bounds', () => {
      expect(validateStringLength('hello', 1, 10)).toBe(true);
      expect(validateStringLength('a', 1, 10)).toBe(true);
      expect(validateStringLength('1234567890', 1, 10)).toBe(true);
    });

    it('should reject strings outside length bounds', () => {
      expect(validateStringLength('', 1, 10)).toBe(false);
      expect(validateStringLength('12345678901', 1, 10)).toBe(false);
    });
  });
});
