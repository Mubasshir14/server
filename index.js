require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const SSLCommerzPayment = require('sslcommerz-lts');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

// Update CORS configuration to allow multiple origins
app.use(cors({
    origin: ['https://gadget-home-c03d3.web.app', 'http://localhost:5173','http://localhost:5174'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3aom8f0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = true; // true for live, false for sandbox

async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const userCollection = client.db('gadgetDB').collection('users');
        const productCollection = client.db('gadgetDB').collection('products');
        const orderCollection = client.db('gadgetDB').collection('orders');
        const cartCollection = client.db('gadgetDB').collection('carts');

        // Generate JWT Token
        app.post('/jwt', (req, res) => {
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

        // Product Routes
        app.route('/product')
            .get(async (req, res) => {
                const result = await productCollection.find().toArray();
                res.send(result);
            })
            .post(async (req, res) => {
                const productItem = req.body;
                const result = await productCollection.insertOne(productItem);
                res.send(result);
            });

        app.route('/product/:id')
            .get(async (req, res) => {
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
            })
            .delete(async (req, res) => {
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
            })
            .patch(async (req, res) => {
                try {
                    const id = req.params.id;
                    const updates = req.body;
                    const query = { _id: new ObjectId(id) };

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

        // User Routes
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

        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // Cart Routes
        app.route('/carts')
            .get(async (req, res) => {
                const email = req.query.email;
                const query = { email: email };
                const result = await cartCollection.find(query).toArray();
                res.send(result);
            })
            .post(async (req, res) => {
                const cartItem = req.body;
                const result = await cartCollection.insertOne(cartItem);
                res.send(result);
            });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        // Payment Route
        app.post('/order', async (req, res) => {
            const { email, name, address, postcode, currency } = req.body;

            try {
                const cartItems = await cartCollection.find({ email }).toArray();

                if (!cartItems || cartItems.length === 0) {
                    return res.status(400).send({ message: 'Cart is empty' });
                }

                const totalAmount = parseFloat(cartItems.reduce((total, item) => {
                    const price = parseFloat(item.price);
                    if (isNaN(price)) {
                        console.error('Invalid price:', item);
                        return total;
                    }
                    return total + price;
                }, 0));

                if (isNaN(totalAmount)) {
                    return res.status(500).send({ message: 'Error calculating total amount' });
                }

                const tran_id = "tran" + new Date().getTime();
                const data = {
                    total_amount: totalAmount,
                    currency: currency,
                    tran_id: tran_id,
                    success_url: `https://gadget-home-server2.onrender.com/success/${tran_id}`,
                    fail_url: `https://gadget-home-server2.onrender.com/fail/${tran_id}`,
                    cancel_url: 'https://gadget-home-server2.onrender.com/cancel',
                    ipn_url: 'https://gadget-home-server2.onrender.com/ipn',
                    shipping_method: 'Courier',
                    product_name: 'Cart Items',
                    product_category: 'Electronic',
                    product_profile: 'general',
                    cus_name: name,
                    cus_email: email,
                    cus_add1: address,
                    cus_add2: address,
                    cus_city: address,
                    cus_state: address,
                    cus_postcode: postcode,
                    cus_country: 'Bangladesh',
                    cus_phone: '01711111111',
                    cus_fax: '01711111111',
                    ship_name: name,
                    ship_add1: address,
                    ship_add2: address,
                    ship_city: address,
                    ship_state: address,
                    ship_postcode: postcode,
                    ship_country: 'Bangladesh',
                };

                const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
                const apiResponse = await sslcz.init(data);
                const GatewayPageURL = apiResponse.GatewayPageURL;
                res.send({ url: GatewayPageURL });

                const finalOrder = {
                    email,
                    cartItems,
                    paidStatus: false,
                    transectionId: tran_id,
                };

                await orderCollection.insertOne(finalOrder);
            } catch (error) {
                console.error('Error processing order:', error);
                res.status(500).json({ message: 'Internal Server Error' });
            }
        });

        // Success and Failure Handlers
        app.post('/success/:tranID', async (req, res) => {
            const { tranID } = req.params;
            const result = await orderCollection.updateOne(
                { transectionId: tranID },
                { $set: { paidStatus: true } }
            );
            if (result.modifiedCount > 0) {
                res.redirect(`https://gadget-home-68119.web.app/payment/success/${tranID}`);
            }
        });

        app.post('/fail/:tranID', async (req, res) => {
            const { tranID } = req.params;
            const result = await orderCollection.deleteOne({ transectionId: tranID });
            if (result.deletedCount > 0) {
                res.redirect(`https://gadget-home-68119.web.app/payment/fail/${tranID}`);
            }
        });

        app.get('/', (req, res) => {
            res.send('Gadget Home is Running!');
        });

        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    } catch (error) {
        console.error("MongoDB Connection Error: ", error);
        process.exit(1);
    }
}

run().catch(console.error);
