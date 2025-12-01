import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IConsent extends Document {
  userId: string;
  consents: {
    essential: {
      dataProcessing: {
        given: boolean;
        givenAt: Date;
        required: boolean;
      };
      accountCreation: {
        given: boolean;
        givenAt: Date;
        required: boolean;
      };
    };
    functional: {
      locationServices: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      notifications: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      profilePublic: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
    };
    marketing: {
      emailMarketing: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      smsMarketing: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      pushMarketing: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
    };
    analytics: {
      usageAnalytics: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      performanceMonitoring: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
    };
    thirdParty: {
      verificationServices: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
      paymentProcessing: {
        given: boolean;
        givenAt?: Date;
        withdrawnAt?: Date;
        purpose: string;
        required: boolean;
      };
    };
  };
  agreements: {
    termsOfService?: {
      version?: string;
      acceptedAt?: Date;
      acceptedVersion?: string;
      ipAddress?: string;
      userAgent?: string;
    };
    privacyPolicy?: {
      version?: string;
      acceptedAt?: Date;
      acceptedVersion?: string;
      ipAddress?: string;
      userAgent?: string;
    };
    cookiePolicy?: {
      version?: string;
      acceptedAt?: Date;
      acceptedVersion?: string;
      ipAddress?: string;
      userAgent?: string;
    };
  };
  consentHistory: Array<{
    consentType: string;
    action: 'given' | 'withdrawn' | 'updated';
    givenAt?: Date;
    withdrawnAt?: Date;
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
  }>;
  dataProcessing: {
    lastExportedAt?: Date;
    exportCount: number;
    lastModifiedAt?: Date;
    dataRetentionConsent?: {
      given?: boolean;
      expiresAt?: Date;
    };
  };
  communicationPreferences: {
    preferredLanguage: string;
    preferredChannel: string;
    frequency: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
  
  // Instance methods
  updateConsent(consentPath: string, value: boolean, ipAddress: string, userAgent: string, reason?: string): Promise<IConsent>;
  hasConsent(consentPath: string): boolean;
  getActiveConsents(): Array<{
    type: string;
    givenAt: Date;
    purpose?: string;
    required?: boolean;
  }>;
}

const ConsentSchema = new Schema<IConsent>({
  userId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  consents: {
    essential: {
      dataProcessing: {
        given: { type: Boolean, default: true },
        givenAt: { type: Date, default: Date.now },
        required: { type: Boolean, default: true }
      },
      accountCreation: {
        given: { type: Boolean, default: true },
        givenAt: { type: Date, default: Date.now },
        required: { type: Boolean, default: true }
      }
    },
    functional: {
      locationServices: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Enable location-based task matching and navigation' },
        required: { type: Boolean, default: false }
      },
      notifications: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Send task updates, messages, and important alerts' },
        required: { type: Boolean, default: false }
      },
      profilePublic: {
        given: { type: Boolean, default: true },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Make profile visible to other users for task matching' },
        required: { type: Boolean, default: false }
      }
    },
    marketing: {
      emailMarketing: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Receive promotional emails and newsletters' },
        required: { type: Boolean, default: false }
      },
      smsMarketing: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Receive promotional SMS messages' },
        required: { type: Boolean, default: false }
      },
      pushMarketing: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Receive promotional push notifications' },
        required: { type: Boolean, default: false }
      }
    },
    analytics: {
      usageAnalytics: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Analyze app usage to improve features and performance' },
        required: { type: Boolean, default: false }
      },
      performanceMonitoring: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Monitor app performance and crashes' },
        required: { type: Boolean, default: false }
      }
    },
    thirdParty: {
      verificationServices: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Share data with Cashfree for Aadhaar verification' },
        required: { type: Boolean, default: false }
      },
      paymentProcessing: {
        given: { type: Boolean, default: false },
        givenAt: Date,
        withdrawnAt: Date,
        purpose: { type: String, default: 'Share data with payment gateway for transaction processing' },
        required: { type: Boolean, default: false }
      }
    }
  },
  agreements: {
    termsOfService: {
      version: String,
      acceptedAt: Date,
      acceptedVersion: String,
      ipAddress: String,
      userAgent: String
    },
    privacyPolicy: {
      version: String,
      acceptedAt: Date,
      acceptedVersion: String,
      ipAddress: String,
      userAgent: String
    },
    cookiePolicy: {
      version: String,
      acceptedAt: Date,
      acceptedVersion: String,
      ipAddress: String,
      userAgent: String
    }
  },
  consentHistory: [{
    consentType: String,
    action: {
      type: String,
      enum: ['given', 'withdrawn', 'updated']
    },
    givenAt: Date,
    withdrawnAt: Date,
    ipAddress: String,
    userAgent: String,
    reason: String
  }],
  dataProcessing: {
    lastExportedAt: Date,
    exportCount: { type: Number, default: 0 },
    lastModifiedAt: Date,
    dataRetentionConsent: {
      given: Boolean,
      expiresAt: Date
    }
  },
  communicationPreferences: {
    preferredLanguage: {
      type: String,
      default: 'en',
      enum: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'bn']
    },
    preferredChannel: {
      type: String,
      enum: ['email', 'sms', 'push', 'in-app'],
      default: 'in-app'
    },
    frequency: {
      type: String,
      enum: ['immediate', 'daily', 'weekly', 'never'],
      default: 'immediate'
    }
  }
}, {
  timestamps: true
});

// Indexes
ConsentSchema.index({ userId: 1 }, { unique: true });
ConsentSchema.index({ 'dataProcessing.dataRetentionConsent.expiresAt': 1 });

// Pre-save hook
ConsentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find by userId
ConsentSchema.statics.findByUserId = function(userId: string) {
  return this.findOne({ userId });
};

// Static method to create default consent
ConsentSchema.statics.createDefaultConsent = async function(userId: string, ipAddress: string, userAgent: string) {
  const consent = new this({
    userId,
    agreements: {
      termsOfService: {
        version: '1.0.0',
        acceptedAt: new Date(),
        acceptedVersion: '1.0.0',
        ipAddress,
        userAgent
      },
      privacyPolicy: {
        version: '1.0.0',
        acceptedAt: new Date(),
        acceptedVersion: '1.0.0',
        ipAddress,
        userAgent
      }
    }
  });
  
  return await consent.save();
};

// Instance method to update consent
ConsentSchema.methods.updateConsent = function(
  consentPath: string,
  value: boolean,
  ipAddress: string,
  userAgent: string,
  reason?: string
) {
  const pathParts = consentPath.split('.');
  let current: any = this.consents;
  
  for (let i = 0; i < pathParts.length - 1; i++) {
    current = current[pathParts[i]];
  }
  
  const consentKey = pathParts[pathParts.length - 1];
  const now = new Date();
  
  if (!current[consentKey]) {
    current[consentKey] = {};
  }
  
  current[consentKey].given = value;
  
  if (value) {
    current[consentKey].givenAt = now;
    current[consentKey].withdrawnAt = null;
  } else {
    current[consentKey].withdrawnAt = now;
  }
  
  // Add to history
  this.consentHistory.push({
    consentType: consentPath,
    action: value ? 'given' : 'withdrawn',
    givenAt: value ? now : undefined,
    withdrawnAt: value ? undefined : now,
    ipAddress,
    userAgent,
    reason
  });
  
  return this.save();
};

// Instance method to check if consent is given
ConsentSchema.methods.hasConsent = function(consentPath: string): boolean {
  const pathParts = consentPath.split('.');
  let current: any = this.consents;
  
  for (const part of pathParts) {
    if (!current[part]) return false;
    current = current[part];
  }
  
  return current.given === true;
};

// Instance method to get all active consents
ConsentSchema.methods.getActiveConsents = function() {
  const active: Array<{ type: string; givenAt: Date; purpose?: string; required?: boolean }> = [];
  
  const checkConsents = (obj: any, path: string = '') => {
    for (const key in obj) {
      const currentPath = path ? `${path}.${key}` : key;
      const value = obj[key];
      
      if (value && typeof value === 'object') {
        if (value.given === true && !value.withdrawnAt) {
          active.push({
            type: currentPath,
            givenAt: value.givenAt,
            purpose: value.purpose,
            required: value.required
          });
        } else if (!value.hasOwnProperty('given')) {
          checkConsents(value, currentPath);
        }
      }
    }
  };
  
  checkConsents(this.consents);
  return active;
};

const Consent: Model<IConsent> = mongoose.model<IConsent>('Consent', ConsentSchema);

export default Consent;


