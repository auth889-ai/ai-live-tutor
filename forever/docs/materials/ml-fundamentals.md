# Machine Learning Fundamentals: The Rickshaw Fare Predictor

## 1. One problem, end to end

Arif runs a rickshaw-booking app in Dhaka. He wants the app to PREDICT the fare of a ride
before it starts, and later to CLASSIFY which riders are likely to cancel. These two tasks
— predicting a number and predicting a category — are regression and classification, the
two workhorse problems of supervised machine learning. Every concept in this course is
taught on Arif's data.

## 2. The dataset

Arif logs 10 recent rides: distance in kilometers and the fare the rider actually paid
(in BDT):

| Distance (km) | Fare (BDT) |
|---|---|
| 1 | 55 |
| 2 | 70 |
| 3 | 95 |
| 4 | 110 |
| 5 | 135 |
| 6 | 150 |
| 7 | 175 |
| 8 | 190 |
| 9 | 215 |
| 10 | 230 |

A model is a rule that maps input (distance) to output (fare). The simplest useful rule is
a line: fare = w × distance + b, where w (the weight) and b (the bias) are numbers the
LEARNING algorithm must find.

## 3. Loss: measuring how wrong a model is

Guess w = 20, b = 30. For the 3 km ride the prediction is 20 × 3 + 30 = 90, but the true
fare is 95, so the error is 5. Mean squared error (MSE) averages the squared errors over
all rides. Squaring punishes big mistakes more than small ones and makes the math smooth.

For the guess w = 20, b = 30, the MSE over the 10 rides works out to 12.5 (errors of 5, 0, 5, 0, 5, 0, 5, 0, 5, 0 — squared and averaged). For a worse
guess like w = 10, b = 30 the MSE explodes to 4112.5 — the loss function turns "how wrong
am I" into a single number a computer can minimize.

## 4. Gradient descent: learning as walking downhill

Gradient descent improves w and b step by step: compute the slope of the loss with respect
to each parameter, then move a small step (the learning rate) against the slope. With a
learning rate of 0.01, training from w = 0, b = 0, the loss falls epoch by epoch:

| Epoch | MSE |
|---|---|
| 1 | 23562.5 |
| 5 | 1250.0 |
| 10 | 310.0 |
| 20 | 85.0 |
| 40 | 46.0 |
| 80 | 41.0 |

The curve drops fast at first and then flattens — the model is converging near the best
line, roughly w = 19.8, b = 33.3 for this data. A learning rate too large (say 0.5) makes
the loss DIVERGE: each step overshoots the valley and the numbers grow without bound. A
learning rate too small wastes epochs crawling.

## 5. Train/test split: the honesty rule

A model must be graded on rides it has never seen. Arif splits his full log of 100 rides
into 80 training rides and 20 test rides (an 80/20 split). The model learns ONLY from the
80; the 20 are locked away until grading time. Skipping this step is how you fool yourself:
a model can memorize its training data and still be useless tomorrow.

## 6. Overfitting: memorizing instead of learning

Arif tries a very flexible model (a degree-9 polynomial). It scores 95 percent accuracy on
the training rides but only 70 percent on the held-out test rides — a 25 point gap. That
gap is the signature of OVERFITTING: the model learned the noise of the training set, not
the pattern of the world. The straight line, by contrast, scores 88 percent on training
and 85 percent on test — a 3 point gap. The honest question is never "how well does it fit
what it saw" but "how well does it generalize to what it has not seen."

## 7. Classification and the confusion matrix

Now the cancel-prediction task: will a rider cancel (positive class) or not? On 100 test
bookings the classifier's results form a confusion matrix:

|  | Predicted cancel | Predicted no-cancel |
|---|---|---|
| Actually cancelled | 40 (true positives) | 20 (false negatives) |
| Actually completed | 10 (false positives) | 30 (true negatives) |

From these four cells every headline metric follows by arithmetic:

- Accuracy = (40 + 30) / 100 = 0.70 — the share of all predictions that were right.
- Precision = 40 / (40 + 10) = 0.80 — when the model says "cancel", how often is it right.
- Recall = 40 / (40 + 20) = 0.667 — of the real cancellations, how many it caught.
- F1 score = 2 × (0.80 × 0.667) / (0.80 + 0.667) = 0.727 — the harmonic balance of the two.

## 8. Why accuracy alone lies

Suppose only 5 of 100 bookings cancel. A lazy model that predicts "no-cancel" for everyone
scores 95 percent accuracy while catching ZERO cancellations — recall 0. On imbalanced
data, accuracy flatters the useless model; precision and recall expose it. Which metric
matters depends on the cost of each mistake: if calling a rider wrongly is cheap but a
surprise cancellation is expensive, chase recall; if false alarms are costly, chase
precision.

## 9. The bias-variance trade-off

The straight line UNDERFITS if the true pattern curves (high bias: wrong assumptions,
similar errors on train and test, both mediocre). The degree-9 polynomial OVERFITS (high
variance: tiny changes in training data swing the model wildly, train great, test poor).
Model selection is the discipline of choosing capacity to match the data: start simple,
measure the train-test gap, add capacity only while the TEST score improves.

## 10. The workflow that never changes

Every supervised project repeats one loop: split the data honestly, fit on train, measure
on test, diagnose (underfit? overfit? wrong metric?), adjust one thing, repeat. The model
is never trusted because its story sounds right; it is trusted because its measured test
performance says so. In machine learning, as in this course, every claim must survive an
execution.
