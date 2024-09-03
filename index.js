require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3aom8f0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const userCollection = client.db('gadgetDB').collection('users');
        const productCollection = client.db('gadgetDB').collection('products');
        const cartCollection = client.db('gadgetDB').collection('carts');

        // Generate JWT Token
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '24h'
            });
            res.send({ token });
        });

        // Middleware to Verify JWT Token
        const verifyToken = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'Unauthorized Access' });
            }
            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(403).send({ message: 'Forbidden Access' });
                }
                req.user = decoded;
                next();
            });
        };

        // Get all products
        app.get('/product', async (req, res) => {
            const result = await productCollection.find().toArray();
            res.send(result);
        });

        // Add a new product
        app.post('/product', async (req, res) => {
            const productItem = req.body;
            const result = await productCollection.insertOne(productItem);
            res.send(result);
        });

        // Get a specific product by ID
        app.get('/product/:id', async (req, res) => {
            const id = req.params.id;
            try {
                if (ObjectId.isValid(id)) {
                    const query = { _id: new ObjectId(id) };
                    const result = await productCollection.findOne(query);
                    if (result) {
                        res.send(result);
                    } else {
                        res.status(404).send({ error: 'Product not found' });
                    }
                } else {
                    res.status(400).send({ error: 'Invalid ID format' });
                }
            } catch (error) {
                res.status(500).send({ error: 'Internal Server Error' });
            }
        });

        // // delete 
        // app.delete('product/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const query = { _id: new ObjectId(id) };
        //     const result = await productCollection.deleteOne(query);
        //     res.send(result);
        // })
        // delete product by id
        app.delete('/product/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const query = { _id: new ObjectId(id) };
                const result = await productCollection.deleteOne(query);

                if (result.deletedCount === 1) {
                    res.status(200).json({ message: 'Product deleted successfully.' });
                } else {
                    res.status(404).json({ message: 'Product not found.' });
                }
            } catch (error) {
                console.error('Error deleting product:', error);
                res.status(500).json({ message: 'Internal server error.' });
            }
        });
        
        // update product
        app.patch('/product/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updates = req.body;
                const query = { _id: new ObjectId(id) };
                
                // Update the product in the database
                const result = await productCollection.updateOne(query, { $set: updates });
        
                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'Product not found' });
                }
                res.send(result);
            } catch (error) {
                console.error("Error updating product:", error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });


        // Add a new user
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await userCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'User Already Created', insertedId: null });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        // Get all users
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // Get all cart items for a specific user
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        // Add a new cart item
        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });

        // Delete a cart item by ID
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Optionally close the client connection
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Gadget Home is Running');
});

app.listen(port, () => {
    console.log(`Gadget Home is Running on Port: ${port}`);
});
