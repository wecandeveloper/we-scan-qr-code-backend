/**
 * Test script for payment encryption utility
 * Run with: node app/utils/test-paymentEncryption.js
 * 
 * Make sure PAYMENT_ENCRYPTION_KEY is set in your .env file
 */

require('dotenv').config();
const { encryptPaymentKey, decryptPaymentKey, isEncrypted } = require('./paymentEncryption');

// Test data
const testKey = 'sk_test_1234567890abcdefghijklmnopqrstuvwxyz';

console.log('🔐 Testing Payment Encryption Utility\n');
console.log('='.repeat(50));

// Test 1: Encryption
console.log('\n1. Testing Encryption:');
console.log('Original Key:', testKey);
try {
    const encrypted = encryptPaymentKey(testKey);
    console.log('Encrypted:', encrypted);
    console.log('Is Encrypted?', isEncrypted(encrypted));
    
    // Test 2: Decryption
    console.log('\n2. Testing Decryption:');
    const decrypted = decryptPaymentKey(encrypted);
    console.log('Decrypted:', decrypted);
    console.log('Match?', decrypted === testKey ? '✅ YES' : '❌ NO');
    
    // Test 3: Null/Empty handling
    console.log('\n3. Testing Null/Empty Handling:');
    const nullEncrypted = encryptPaymentKey(null);
    const nullDecrypted = decryptPaymentKey(null);
    console.log('Null encrypted:', nullEncrypted);
    console.log('Null decrypted:', nullDecrypted);
    
    // Test 4: Plain text (backward compatibility)
    console.log('\n4. Testing Plain Text (Backward Compatibility):');
    const plainText = 'pk_live_1234567890';
    const decryptedPlain = decryptPaymentKey(plainText);
    console.log('Plain text:', plainText);
    console.log('Decrypted (should be same):', decryptedPlain);
    console.log('Match?', decryptedPlain === plainText ? '✅ YES' : '❌ NO');
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ All tests completed!');
    
} catch (error) {
    console.error('❌ Error:', error.message);
    if (!process.env.PAYMENT_ENCRYPTION_KEY) {
        console.error('\n⚠️  Make sure PAYMENT_ENCRYPTION_KEY is set in your .env file');
    }
}

