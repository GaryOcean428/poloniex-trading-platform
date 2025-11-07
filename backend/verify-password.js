import bcrypt from 'bcryptjs';

const password = 'I.Am.Dev.1';
const existingHash = '$2b$12$kpGETKNQmTytY6LOl7gg0eRSxuIH0G/akMV4sA/pKl5Vr9YowYhFq';

console.log('Testing password:', password);
console.log('Against hash:', existingHash);

// Verify if password matches existing hash
bcrypt.compare(password, existingHash, (err, result) => {
  if (err) {
    console.error('Error comparing:', err);
    return;
  }
  
  console.log('\nPassword matches existing hash:', result);
  
  if (!result) {
    // Generate new hash for the password
    bcrypt.hash(password, 10, (err, newHash) => {
      if (err) {
        console.error('Error generating hash:', err);
        return;
      }
      
      console.log('\nNew hash for password "I.Am.Dev.1":');
      console.log(newHash);
      console.log('\nSQL to update:');
      console.log(`UPDATE users SET password_hash = '${newHash}' WHERE email = 'braden.lang77@gmail.com';`);
    });
  }
});
