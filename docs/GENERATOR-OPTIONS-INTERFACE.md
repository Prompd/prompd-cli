# Generator Options Interface - Standardized Configuration System

## 🎯 **Design Philosophy**

Prompd generators use a **hybrid options system** that balances simplicity for common use cases with power for complex configurations:

- **Simple cases are simple** - common options as intuitive flags
- **Complex cases are possible** - advanced configuration via JSON
- **Consistent interface** - all generators follow same patterns
- **Discoverable** - help system shows available options clearly

## 🏗️ **Option Categories**

### **1. Common Options (All Generators)**
Standard options available across all `prompd-generators-*` packages:

```bash
--output <path>           # Output directory (default: ./generated)
--format <format>         # Output format (varies by generator)
--help                    # Show generator-specific help
--verbose                 # Detailed generation logging
--dry-run                 # Show what would be generated without creating files
```

### **2. Generator-Specific Simple Options**
Easy-to-remember flags for frequently used settings:

```bash
# Example: prompd-generators-webforms
--framework <framework>   # bootstrap5, tailwind, bulma
--theme <theme>          # light, dark, auto
--language <lang>        # en, es, fr, de

# Example: prompd-generators-openapi  
--spec-version <version> # 3.0, 3.1
--server-url <url>       # Default server URL
--auth-type <type>       # bearer, apikey, oauth2
```

### **3. Feature Flags**
Boolean flags for common add-on features:

```bash
--with-csrf              # Add CSRF protection
--with-captcha           # Add reCAPTCHA integration  
--with-validation        # Add client-side validation
--a11y-compliant         # Include accessibility features
--responsive             # Mobile-responsive design
--with-tests             # Generate test files
--with-docs              # Generate documentation
```

### **4. Advanced Configuration**
Complex configuration via JSON for power users:

```bash
--options <json>         # Inline JSON configuration
--options-file <file>    # Load from JSON/YAML file
```

## 📋 **Usage Patterns**

### **Simple Usage (Beginner-Friendly)**
```bash
# Minimal - uses all defaults
prompd generate webforms contact-form.prompd

# Common options as flags
prompd generate webforms user-registration.prompd \
  --framework bootstrap5 \
  --with-csrf \
  --responsive \
  --output ./forms/
```

### **Intermediate Usage**
```bash
# Mix of flags and simple JSON options
prompd generate webforms survey-form.prompd \
  --framework tailwind \
  --with-csrf \
  --with-validation \
  --options '{"multiStep": true, "saveProgress": true}'
```

### **Advanced Usage**
```bash
# Complex configuration with options file
prompd generate webforms enterprise-form.prompd \
  --framework bootstrap5 \
  --options-file ./enterprise-config.json
```

### **Configuration File Example**
```json
// enterprise-config.json
{
  "multiStep": true,
  "steps": [
    {"id": "personal", "title": "Personal Information"},
    {"id": "company", "title": "Company Details"},
    {"id": "preferences", "title": "Preferences"},
    {"id": "confirmation", "title": "Review & Submit"}
  ],
  "styling": {
    "theme": "corporate",
    "brandColors": {
      "primary": "#1a365d",
      "secondary": "#2d3748",
      "accent": "#3182ce"
    },
    "customCss": "./corporate-theme.css",
    "logoUrl": "./assets/company-logo.png"
  },
  "validation": {
    "realtime": true,
    "showProgress": true,
    "saveOnStep": true,
    "validationMessages": {
      "required": "This field is required for compliance",
      "email": "Please enter a valid corporate email address"
    }
  },
  "integrations": {
    "analytics": {
      "provider": "google-analytics",
      "trackingId": "GA-XXXX-X",
      "events": ["form_start", "step_complete", "form_submit"]
    },
    "crm": {
      "provider": "salesforce",
      "leadSource": "website_form",
      "customFields": {
        "department": "form_department",
        "budget": "form_budget_range"
      }
    }
  },
  "security": {
    "csrfProtection": true,
    "rateLimiting": {
      "maxAttempts": 5,
      "windowMs": 900000
    },
    "dataEncryption": true
  },
  "accessibility": {
    "wcagLevel": "AA",
    "screenReaderOptimized": true,
    "highContrastMode": true,
    "keyboardNavigation": true
  }
}
```

## 🔧 **Generator Implementation Interface**

### **Standardized Options Interface**
```typescript
interface GeneratorOptions {
  // Common options (all generators must support)
  output?: string;
  format?: string;
  verbose?: boolean;
  dryRun?: boolean;
  
  // Generator-specific simple options (varies by generator)
  framework?: string;
  theme?: string;
  language?: string;
  
  // Feature flags (generator-specific but predictable naming)
  withCsrf?: boolean;
  withCaptcha?: boolean;
  withValidation?: boolean;
  withTests?: boolean;
  withDocs?: boolean;
  a11yCompliant?: boolean;
  responsive?: boolean;
  
  // Advanced configuration
  options?: Record<string, any>;
  optionsFile?: string;
}

interface GeneratorContext {
  inputFile: PrompdFile;
  outputPath: string;
  options: GeneratorOptions;
  metadata: {
    generatorName: string;
    generatorVersion: string;
    timestamp: Date;
    user?: string;
  };
}
```

### **Option Resolution Order**
1. **Default values** (defined in generator)
2. **Options file** (`--options-file config.json`)
3. **Inline JSON** (`--options '{...}'`)
4. **CLI flags** (highest priority)

```typescript
// Example resolution
const resolvedOptions = {
  ...generatorDefaults,
  ...loadFromFile(options.optionsFile),
  ...parseJSON(options.options),
  ...cliFlags
};
```

## 📚 **Generator-Specific Examples**

### **`prompd-generators-webforms`**
```bash
# Available options
prompd generate webforms --help

Generator Options:
  --framework <framework>   CSS framework: bootstrap5, tailwind, bulma, custom
  --theme <theme>          Theme: light, dark, auto, custom
  --language <lang>        Interface language: en, es, fr, de, it

Feature Flags:
  --with-csrf              Add CSRF token protection
  --with-captcha           Add reCAPTCHA v3 integration
  --with-validation        Add real-time client validation
  --with-progress          Add progress indicators for multi-step forms
  --responsive             Generate mobile-responsive forms
  --a11y-compliant         Include WCAG 2.1 AA accessibility features

Advanced Options (via --options or --options-file):
  - multiStep: boolean      Multi-step form configuration
  - styling: object        Custom styling and branding
  - validation: object     Advanced validation rules
  - integrations: object   Third-party service integrations
```

### **`prompd-generators-openapi`**
```bash
# Available options
prompd generate openapi --help

Generator Options:
  --spec-version <version>  OpenAPI version: 3.0, 3.1
  --server-url <url>       Default server URL for API
  --auth-type <type>       Authentication: bearer, apikey, oauth2, none
  --format <format>        Output format: json, yaml

Feature Flags:
  --with-examples          Include request/response examples
  --with-schemas           Generate detailed schema definitions
  --with-security          Include security definitions
  --with-docs              Generate human-readable documentation

Advanced Options:
  - servers: array         Multiple server configurations
  - security: object       Advanced security schemes
  - info: object          API metadata and contact information
  - externalDocs: object   Links to external documentation
```

### **`prompd-generators-react`**
```bash
# Available options  
prompd generate react --help

Generator Options:
  --typescript             Generate TypeScript components
  --framework <framework>  React framework: create-react-app, next, vite
  --styling <approach>     Styling: css-modules, styled-components, tailwind
  --state-management <lib> State: useState, redux, zustand, none

Feature Flags:
  --with-hooks             Generate custom hooks
  --with-tests             Generate Jest/RTL test files
  --with-stories           Generate Storybook stories  
  --with-forms             Include form handling (react-hook-form)
  --responsive             Mobile-responsive components

Advanced Options:
  - component: object      Component configuration and props
  - styling: object       Advanced styling configuration  
  - testing: object       Test configuration and scenarios
  - storybook: object     Storybook configuration
```

## 🎯 **Help System Design**

### **Tiered Help Information**
```bash
# Basic help - shows common options
prompd generate webforms --help

# Detailed help - shows all options including advanced
prompd generate webforms --help --verbose

# Show examples
prompd generate webforms --examples

# Show option schema (for tooling/IDEs)
prompd generate webforms --schema
```

### **Interactive Option Builder**
```bash
# Interactive mode for complex configurations
prompd generate webforms contact-form.prompd --interactive

# Prompts user through:
# 1. Framework selection
# 2. Feature selection  
# 3. Styling preferences
# 4. Advanced options (optional)
# 5. Generate config file for reuse
```

## 🚀 **Benefits of This System**

### **For Beginners:**
- **Gentle learning curve** - start with simple flags
- **Discoverable** - help system guides through options
- **Sensible defaults** - works out of the box

### **For Power Users:**
- **Full control** - complex configurations via JSON
- **Reusable** - save configurations in files
- **Composable** - mix flags and JSON as needed

### **For Tool Authors:**
- **Consistent interface** - same patterns across all generators
- **Extensible** - easy to add new options
- **Documented** - standardized help and schema generation

### **For Enterprise:**
- **Configuration management** - version control config files
- **Team consistency** - shared configuration standards
- **Integration friendly** - JSON configs work with CI/CD

## 🔄 **Option Validation and Error Handling**

### **Validation Rules**
```typescript
interface OptionValidation {
  // Type validation
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  
  // Value constraints  
  enum?: any[];           // Allowed values
  pattern?: string;       // Regex pattern for strings
  minimum?: number;       // Min value for numbers
  maximum?: number;       // Max value for numbers
  
  // Dependencies
  requires?: string[];    // Other options that must be present
  conflicts?: string[];   // Options that cannot be used together
  
  // Validation function
  validate?: (value: any, allOptions: GeneratorOptions) => boolean | string;
}
```

### **Error Messages**
```bash
# Clear, actionable error messages
Error: Invalid framework 'bootstrap6'
  Available frameworks: bootstrap5, tailwind, bulma, custom
  
Error: Option conflict detected
  Cannot use --with-captcha and --options.captcha.disabled=true together
  
Error: Missing required option
  --auth-type=oauth2 requires --options.oauth.clientId to be specified
```

## 📖 **Documentation Generation**

### **Auto-Generated Documentation**
```bash
# Generate markdown documentation for all options
prompd generate webforms --generate-docs --output ./docs/

# Outputs:
# - webforms-generator-options.md
# - webforms-generator-examples.md  
# - webforms-generator-schema.json
```

### **Option Schema Export**
```bash
# Export JSON Schema for IDE integration
prompd generate webforms --export-schema > webforms-options.schema.json

# IDEs can use this for:
# - Auto-completion in JSON config files
# - Validation of configuration files
# - Hover documentation for options
```

---

## 🎯 **Implementation Priority**

### **Phase 1: Core Interface**
- Standardized option parsing
- Common options support (`--output`, `--format`, `--help`)
- Basic feature flags

### **Phase 2: Advanced Configuration**  
- JSON options support (`--options`, `--options-file`)
- Option validation and error handling
- Help system improvements

### **Phase 3: Developer Experience**
- Interactive option builder
- Configuration file generation
- Documentation generation
- IDE integration (schema export)

This standardized options interface ensures all Prompd generators provide a consistent, powerful, and user-friendly experience while allowing for generator-specific customization and advanced use cases.