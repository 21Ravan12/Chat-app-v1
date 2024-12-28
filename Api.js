const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const client = new MongoClient('mongodb://localhost:27017');
const dbName = 'My_social_web_database';
const dbName1 = 'chatApp';
let db;
let db1;

client.connect()
  .then(() => {
    db = client.db(dbName);
    db1 = client.db(dbName1);
    console.log("Connected to MongoDB");
  })
  .catch(err => console.error("MongoDB connection failed:", err));

// Hardcoded email credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '', // Your email
    pass: '',        // Your app password
  }
});

// Send the email with verification code
const sendCodeEmail = async (email, code) => {
  const mailOptions = {
    from: 'asgarovravan@gmail.com',
    to: email,
    subject: 'Identification',
    text: `Your identification code is: ${code}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully!");
  } catch (err) {
    console.error("Email error:", err);
    throw new Error(`Failed to send email. ${err.message}`);
  }
};

// Maps to store temporary data (e.g., verification codes)
const signinStorage = new Map();
const forgetStorage = new Map();

// User registration with verification code
app.post('/api-enter', async (req, res) => {
  const { email, password, name, bio, birthyear } = req.body;

  // Check if email already exists
  const existingUser = await db.collection('users').findOne({ email });
  if (existingUser) {
    return res.status(409).json({ message: `This email is already in use: ${email}` });
  }

  // Hash the password before storing it
  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate a random code for verification
  const randomCode = Math.floor(Math.random() * 999999) + 1;
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes expiry

  signinStorage.set(email, { email, password: hashedPassword, name, bio, birthyear, code: randomCode, expiresAt });

  try {
    await sendCodeEmail(email, randomCode);
    res.status(200).json({ message: "Verification code sent successfully!" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Verify the code and complete the registration
app.post('/api-enter-end', async (req, res) => {
  const { code } = req.body;

  // Iterate over signinStorage and find the email that matches the provided code
  const userEntry = Array.from(signinStorage.entries()).find(
    ([_, value]) => String(value.code) === String(code)
  );

  if (!userEntry) {
    return res.status(400).json({ message: "Invalid code entered." });
  }

  const [email, userStorage] = userEntry;

  // Check if the code has expired
  if (Date.now() > userStorage.expiresAt) {
    signinStorage.delete(email); // Remove expired code from memory
    return res.status(400).json({ message: "The verification code has expired." });
  }
   
  // Create a new user object with the stored data
  const newUser = {
    name: userStorage.name,
    email: userStorage.email,
    password: userStorage.password,
    bio: userStorage.bio,
    birthyear: userStorage.birthyear,
  };

  try {
    await db.collection('users').insertOne(newUser);
    signinStorage.delete(email); // Remove user from signinStorage after successful signup
    res.status(200).json({ message: "User successfully signed up!" });
  } catch (err) {
    res.status(500).json({ message: `Error occurred: ${err.message}` }); // Fixed the template string syntax here
  }
});


// Password recovery request (send recovery code)
app.post('/api-forget', async (req, res) => {
  const { email } = req.body;

  const existingUser = await db.collection('users').findOne({ email });
  if (!existingUser) {
    return res.status(404).json({ message: "No user found with this email." });
  }

  const randomCode = Math.floor(Math.random() * 999999) + 1;
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes expiry

  forgetStorage.set(email, { email, code: randomCode, expiresAt });

  try {
    await sendCodeEmail(email, randomCode);
    res.status(200).json({ message: "Password recovery code sent successfully!" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api-forget-end', async (req, res) => {
  const { code } = req.body;

  // "forgetStorage" üzərində bütün email-ləri yoxlayırıq
  const userEntry = Array.from(forgetStorage.entries()).find(
    ([_, value]) => value.code === Number(code)
  );

  if (!userEntry) {
    return res.status(400).json({ message: "Invalid recovery code entered." });
  }

  const [email, userStorage] = userEntry;

  // Kodun müddəti bitibsə
  if (Date.now() > userStorage.expiresAt) {
    return res.status(400).json({ message: "The recovery code has expired." });
  }

  // Əgər kod doğrudursa, müvəffəqiyyəti qaytarırıq
  res.status(200).json({ message: "Code successfully verified!", email });
});

app.post('/api-login', async (req, res) => {
  const { email, password } = req.body;

  const user = await db.collection('users').findOne({ email });

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  // Hashli şifreyi kontrol etme
  const isMatch = await bcrypt.compare(password, user.password);

  if (isMatch) {
    res.status(200).json({ message: "Login successful!" });
  } else {
    res.status(400).json({ message: "Invalid password." });
  }
});


app.post('/api-profile-get', async (req, res) => {
  try {
    const { email } = req.body; // Get email from the client request body

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    // Fetch the user from the database
    const user = await db.collection('users').findOne({ email });
    
    // Check if the user exists
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Calculate the user's age based on their birth year
    const currentYear = new Date().getFullYear();
    const age = currentYear - user.birthyear;

    // Prepare the profile data
    const profileData = {
      profileImage: user.profileImage || '', // Optional field: use an empty string if not available
      name: user.name,
      email: user.email,
      bio: user.bio,
      age: age, // Calculate age from birthyear
    };

    // Send the response with the profile data
    res.status(200).json(profileData);
  } catch (err) {
    // Handle unexpected errors
    console.error('Error fetching profile:', err);
    res.status(500).json({ message: `Error: ${err.message}` }); // Fix the string interpolation
  }
});


app.put('/api-profile-save', async (req, res) => {
  const {email, name, bio, age, profileImage } = req.body;
  const currentYear = new Date().getFullYear();
  const birthyear = currentYear - age;

  try {
    const result = await db.collection('users').updateOne(
      { email: email }, 
      { $set: { name, bio, birthyear, profileImage } }
    );

    if (result.matchedCount > 0) {
      res.status(200).json({ message: "Profile updated successfully!" });
    } else {
      res.status(404).json({ message: "User not found." });
    }
  } catch (err) {
    res.status(500).json({ message: `Error: ${err.message}` });  // Corrected template literal
  }
});

app.put('/api-friend-add', async (req, res) => {
  const { friend, email } = req.body;

  console.log("Request body:", req.body); // Log the incoming request body for debugging

  try {
    // Find the user by email and check if they exist
    const user = await db.collection('users').findOne({ email: email });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Check if the friend is already in the user's friends list
    if (user.friends && user.friends.includes(friend)) {
      return res.status(400).json({ message: "This friend is already in the list." });
    }

    // Add the friend to the user's friends list
    const result = await db.collection('users').updateOne(
      { email: email },
      { $addToSet: { friends: friend } } // $addToSet ensures no duplicates
    );

    // Check if the friend was successfully added
    if (result.modifiedCount > 0) {
      res.status(200).json({ message: "Friend added successfully!" });
    } else {
      res.status(500).json({ message: "Failed to add the friend." });
    }
  } catch (err) {
    console.error("Error:", err); // Log the error details for debugging
    res.status(500).json({ message: `Error: ${err.message}` }); // Correct string interpolation
  }
});


app.post('/api-friends-get', async (req, res) => {
  try {
    const { email } = req.body; // Get email from the client request body

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    // Fetch the user from the database
    const user = await db.collection('users').findOne({ email });
    
    // Check if the user exists
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Prepare the profile data
    const profileData = {
      friends: user.friends
    };
    // Send the response with the profile data
    res.status(200).json(profileData);
  } catch (err) {
    // Handle unexpected errors
    console.error('Error fetching profile:', err);
    res.status(500).json({ message: `Error: ${err.message}` }); // Fix the string interpolation
  }
});


app.post('/api-chat-get', async (req, res) => {
  const { sender,receiver } = req.body;
  if (!sender || !receiver) {
    return res.status(400).json({ message: "Sender and receiver are required." });
  }
  try {
    // Mesajları al
    const messages = await db1.collection('messages').find({
      $or: [
        { from: sender, to: receiver },
        { from: receiver, to: sender }
      ]
    }).toArray();

    // Etiketli mesajları döndür
    return res.status(200).json(messages);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ message: "Server error occurred." });
  }
});


const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

