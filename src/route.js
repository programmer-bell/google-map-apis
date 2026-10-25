const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

const { GoogleGenAI } = require("@google/genai");
const { decode } = require("@googlemaps/polyline-codec");

const router = express.Router();
dotenv.config();

// ai api calling 
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// places API - text search 
router.get("/places/search", async(req, res) => {
    try{
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({
                success: false,
                message: "Query parameter is required"   
            })}

            const response = await fetch(
                'https://places.googleapis.com/v1/places:searchText',
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                        'X_Goog-FieldMask': 'places.id, places.displayName, places.formattedAddress, places.location'
                    },
                    body: JSON.stringify({
                        textQuery: query
                    })
                }
            )
        const data = await response.json();

        if(!response.ok) {
            return res.status(500).json({
                success: false,
                message: data   
            })
        }

        const places = data.places || [];
        const formattedPlaces = places.map((place) => ({
            id: place.id,
            name: place.displayName?.text,
            address: place.formattedPlaces,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude,
        }));

        return res.status(200).json({
            success: true,
            count: formattedPlaces.length,
            message: formattedPlaces   
        })
    }catch(err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// places API - nearby search
router.post("/places/nearby", async (req, res) => {
   try{

    const {latitude, longitude, raduis, type} = req.body;
    if(!latitude || !longitude || !raduis || !type) {
        return res.status(400).json({
            success: false,
            message: "All fileds are required!"
        })
    }

    const response = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                'X_Goog-FieldMask': 'places.id, places.displayName, places.formattedAddress, places.locationm places.primaryType'
            },
            body: JSON.stringify({
                includedTypes: [type],
                maxResultCount: 10,
                locationRestriction: {
                    circle: {
                    center: {
                        latitude,
                        longitude
                    },
                    radius
                   }
                }
            }),
        }
    );

    const data = await response.json();
        if(!response.ok) {
            return res.status(500).json({
                success: false,
                message: data   
            })
        }
    
    return res.status(200).json({
        success: true,
        data
    });

   }catch(err){
        return res.status(500).json({
            success: false,
            message: err.message
        })
   } 
});


// places API - placeID search 
router.get("/plcaes/:placeId", async (req, res) => {
   try{

    const { placeId } = req.params;
    if(!placeId) {
        return res.status(400).json({
            success: false,
            message: "PlceId is required!"
        })      
    }

    const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X_Goog-FieldMask': 'id, formattedAddress, rating, userRatingCount, nationalPhoneNumber, regularOpeningHours, reviews',
                    }
            }

    );

    const data = await response.json();
    if(!response.ok) {
        return res.status(500).json({
            success: false,
            message: data   
        })
    }
    
    return res.status(200).json({
        success: true,
        data
    });

   }catch(err){
        return res.status(500).json({
            success: false,
            message: err.message
        })
   } 
});


// places API - placeId anakyzer 
router.get("/places/:placeId/analyze", async(req, res) => {
	try{

    const { placeId } = req.params;
    if(!placeId) {
        return res.status(400).json({
            success: false,
            message: "PlceId is required!"
        })      
    }

    const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X_Goog-FieldMask': 'id, formattedAddress, rating, userRatingCount, nationalPhoneNumber, regularOpeningHours, reviews',
                    }
            }

    );

    if(!response.ok) {
        return res.status(500).json({
            success: false,
            message: response   
        })
    }

    const place = await response.json();

    // prepare review text
    const review = (place.reviews || []).map((review) => review.text?.text).filter(Boolean);
    const reviews = review.join("\n\n");
    // console.log(reviews);

    // ask to gemini 
        const prompt = `You are analyzing a place for someone who wants to work there.

        Place:
        ${place.displayName?.text}

        Rating:
        ${place.rating}

        Number of ratings:
        ${place.userRatingCount}

        Reviews:
        ${reviews.join("\n\n")}

        Answer:
        1. Is this a good place to work?
        2. What are the positive points?
        3. What are the negative points?
        4. Give a final score out of 10.

        Keep the answer practical and concise.`;

        const result = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: prompt
        });

        return res.json({
            success: true,
            place: place.displayName?.text,
            analysis: result.text
        });

	}catch(err){
		return res.status(500).json({
			success: false,
			message: err.message
		})	
	}
});


// routes API 
router.post("/routes", async (req, res) => {
    try{

        const { originaLat, originLng, destinationLat, destinationLng } = req.body;
        const response = await fetch(
            `https://routes.googleapis.com/directions/v2:computeRoutes`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
                },
                body: JSON.stringify({
                    origin: {
                        location: {
                            latLng: {
                                latitude: originLat,
                                longitude: originLng
                            }
                        }
                    },
                    destination: {
                        location: {
                            latLng: {
                                latitude: destinationLat,
                                longitude: destinationLng
                            }
                        }
                    },
                    travelMode: "DRIVE",
                    routingPreference: "TRAFFIC_AWARE"
                })
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }
        return res.json({
            success: true,
            route: data.routes?.[0]
        });

    }catch(err){
		return res.status(500).json({
			success: false,
			message: err.message
		})	
	}
});

module.exports = router;